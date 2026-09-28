import { describe, expect, it, vi } from "vitest"
import {
  createBackupMonitor,
  createBackupMonitorFromEnv,
  createHealthAlerts,
  createHealthCheck,
  createStaffRecipients,
  healthAlertReasons,
  readBackupMaxAgeSeconds,
  type AlertRecipient,
  type BackupRunsClient,
  type Health
} from "../src/health"
import type { LogEntry } from "../src/observability/logger"

// T-088 AC-1: просроченная резервная копия даёт статус деградации и оповещение. Дата копии
// подменяется отметкой прогона (`85-media-and-binary/backups.md` §5, журнал §29.9); получатели —
// все активные `owner` и `admin` (журнал §40 п. 2), канал доставки отложен (§40 п. 1).

const NOW = new Date("2026-09-28T12:00:00.000Z")
const DAY_MS = 24 * 60 * 60 * 1000

const ready = { postgres: async () => [{ ok: 1 }], migrations: async () => true, redis: async () => true }

interface Group {
  kind: "database" | "media"
  status: string
  _max: { completedAt: Date | null }
}

const runsClient = (groups: readonly Group[]): BackupRunsClient => ({
  backupRun: { groupBy: async () => groups }
})

const succeeded = (kind: "database" | "media", completedAt: Date): Group => ({
  kind,
  status: "succeeded",
  _max: { completedAt }
})

const recordingLogger = () => {
  const entries: LogEntry[] = []
  return { entries, logger: { log: (entry: LogEntry) => entries.push(entry) } }
}

const health = async (groups: readonly Group[], now: Date = NOW): Promise<Health> => {
  const check = createHealthCheck({
    ...ready,
    backups: createBackupMonitor({ client: runsClient(groups), now: () => now })
  })
  return check()
}

describe("возраст последней успешной резервной копии", () => {
  it("свежие копии базы и медиа — ok и общий статус ok", async () => {
    const snapshot = await health([
      succeeded("database", new Date(NOW.getTime() - 2 * 60 * 60 * 1000)),
      succeeded("media", new Date(NOW.getTime() - 3 * DAY_MS))
    ])
    expect(snapshot.status).toBe("ok")
    expect(snapshot.backups.database).toEqual({
      status: "ok",
      lastSuccessAt: "2026-09-28T10:00:00.000Z",
      ageSeconds: 7200,
      maxAgeSeconds: 86_400
    })
    expect(snapshot.backups.media.status).toBe("ok")
  })

  it("копия базы старше порога — overdue и деградация без 503", async () => {
    const snapshot = await health([
      succeeded("database", new Date(NOW.getTime() - 25 * 60 * 60 * 1000)),
      succeeded("media", new Date(NOW.getTime() - DAY_MS))
    ])
    expect(snapshot.status).toBe("degraded")
    expect(snapshot.backups.database).toEqual({
      status: "overdue",
      lastSuccessAt: "2026-09-27T11:00:00.000Z",
      ageSeconds: 90_000,
      maxAgeSeconds: 86_400
    })
    expect(snapshot.checks.postgres).toBe(true)
  })

  it("копия медиа старше недели — overdue", async () => {
    const snapshot = await health([
      succeeded("database", new Date(NOW.getTime() - 60_000)),
      succeeded("media", new Date(NOW.getTime() - 8 * DAY_MS))
    ])
    expect(snapshot.status).toBe("degraded")
    expect(snapshot.backups.media.status).toBe("overdue")
    expect(snapshot.backups.database.status).toBe("ok")
  })

  it("отказавший прогон не считается копией: возраст берётся только по успешным", async () => {
    const snapshot = await health([
      succeeded("database", new Date(NOW.getTime() - 25 * 60 * 60 * 1000)),
      { kind: "database", status: "failed", _max: { completedAt: NOW } },
      succeeded("media", NOW)
    ])
    expect(snapshot.backups.database.status).toBe("overdue")
    expect(snapshot.backups.database.lastSuccessAt).toBe("2026-09-27T11:00:00.000Z")
  })

  it("отметок нет и наблюдение не требуется — disabled, общий статус ok", async () => {
    const snapshot = await health([])
    expect(snapshot.status).toBe("ok")
    expect(snapshot.backups.database.status).toBe("disabled")
    expect(snapshot.backups.media.status).toBe("disabled")
  })

  it("копии обязательны, но отметок нет — unknown и деградация", async () => {
    const monitor = createBackupMonitor({ client: runsClient([]), required: true, now: () => NOW })
    expect((await monitor()).database).toEqual({
      status: "unknown",
      lastSuccessAt: null,
      ageSeconds: null,
      maxAgeSeconds: 86_400
    })
  })

  it("отметки одного вида включают наблюдение и за вторым", async () => {
    const monitor = createBackupMonitor({
      client: runsClient([succeeded("database", NOW)]),
      now: () => NOW
    })
    const backups = await monitor()
    expect(backups.database.status).toBe("ok")
    expect(backups.media.status).toBe("unknown")
  })

  it("читает порог из окружения и требует копий в production", async () => {
    expect(readBackupMaxAgeSeconds({})).toEqual({ database: 86_400, media: 604_800 })
    expect(readBackupMaxAgeSeconds({ BACKUP_DATABASE_MAX_AGE_HOURS: "6", BACKUP_MEDIA_MAX_AGE_HOURS: "48" })).toEqual({
      database: 21_600,
      media: 172_800
    })
    expect(() => readBackupMaxAgeSeconds({ BACKUP_DATABASE_MAX_AGE_HOURS: "0" })).toThrow()
    expect(() => readBackupMaxAgeSeconds({ BACKUP_MEDIA_MAX_AGE_HOURS: "часов" })).toThrow()

    const production = createBackupMonitorFromEnv({ NODE_ENV: "production" }, runsClient([]))
    expect((await production()).database.status).toBe("unknown")
  })

  it("повторяет запрос к базе не чаще раза в минуту", async () => {
    vi.useFakeTimers()
    try {
      const groupBy = vi.fn(async () => [succeeded("database", new Date())])
      const monitor = createBackupMonitor({ client: { backupRun: { groupBy } } })
      await Promise.all([monitor(), monitor()])
      expect(groupBy).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(59_999)
      await monitor()
      expect(groupBy).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(2)
      await monitor()
      expect(groupBy).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("оповещение о деградации", () => {
  const overdue = () =>
    health([succeeded("database", new Date(NOW.getTime() - 25 * 60 * 60 * 1000)), succeeded("media", NOW)])

  it("формирует оповещение активным owner и admin с причиной просрочки", async () => {
    const { entries, logger } = recordingLogger()
    const recipients: AlertRecipient[] = [
      { id: "owner-1", role: "owner" },
      { id: "admin-1", role: "admin" }
    ]
    const notify = createHealthAlerts({ recipients: async () => recipients, logger })

    const alert = await notify(await overdue())
    expect(alert).toEqual({
      reasons: ["backup.database.overdue"],
      recipients,
      channel: "deferred"
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      level: "warn",
      event: "system.health",
      data: {
        status: "degraded",
        reasons: ["backup.database.overdue"],
        channel: "deferred",
        recipientCount: 2,
        recipients
      }
    })
  })

  it("берёт получателей из активных служебных записей и не берёт остальных", async () => {
    // Выборка ограничена активными служебными записями; роль вне списка получателей отсеивается
    // и на стороне кода, а не только запросом.
    const findMany = vi.fn(async () => [
      { id: "owner-1", role: "owner" },
      { id: "admin-1", role: "admin" },
      { id: "editor-1", role: "editor" }
    ])
    const recipients = await createStaffRecipients({ user: { findMany } })()
    expect(recipients).toEqual([
      { id: "owner-1", role: "owner" },
      { id: "admin-1", role: "admin" }
    ])
    expect(findMany).toHaveBeenCalledWith({
      where: { role: { in: ["owner", "admin"] }, isServiceAccount: true, archivedAt: null },
      select: { id: true, role: true },
      orderBy: { createdAt: "asc" }
    })
  })

  it("не пишет адресов получателей в журнал состояния", async () => {
    const { entries, logger } = recordingLogger()
    const notify = createHealthAlerts({
      recipients: async () => [{ id: "owner-1", role: "owner" }],
      logger
    })
    await notify(await overdue())
    expect(JSON.stringify(entries)).not.toContain("@")
  })

  it("повторная проверка с той же причиной второго оповещения не формирует", async () => {
    const { entries, logger } = recordingLogger()
    const notify = createHealthAlerts({ recipients: async () => [], logger })
    const snapshot = await overdue()
    expect(await notify(snapshot)).not.toBeNull()
    expect(await notify(snapshot)).toBeNull()
    expect(entries).toHaveLength(1)
  })

  it("новая причина даёт новое оповещение, возврат в норму — запись info", async () => {
    const { entries, logger } = recordingLogger()
    const notify = createHealthAlerts({ recipients: async () => [], logger })
    await notify(await overdue())
    await notify(
      await health([
        succeeded("database", new Date(NOW.getTime() - 25 * 60 * 60 * 1000)),
        succeeded("media", new Date(NOW.getTime() - 8 * DAY_MS))
      ])
    )
    expect(await notify(await health([succeeded("database", NOW), succeeded("media", NOW)]))).toBeNull()
    expect(entries.map((entry) => entry.level)).toEqual(["warn", "warn", "info"])
    expect(entries[1]).toMatchObject({
      data: { reasons: ["backup.database.overdue", "backup.media.overdue"] }
    })
  })

  it("здоровая система с самого начала не даёт записей", async () => {
    const { entries, logger } = recordingLogger()
    const notify = createHealthAlerts({ recipients: async () => [], logger })
    expect(await notify(await health([succeeded("database", NOW), succeeded("media", NOW)]))).toBeNull()
    expect(entries).toHaveLength(0)
  })

  it("недоступный список получателей не отменяет запись о деградации", async () => {
    const { entries, logger } = recordingLogger()
    const notify = createHealthAlerts({
      recipients: async () => {
        throw new Error("database is down")
      },
      logger
    })
    const alert = await notify(await overdue())
    expect(alert?.recipients).toEqual([])
    expect(entries[0]).toMatchObject({ data: { recipientsUnavailable: true, recipientCount: 0 } })
  })

  it("перечисляет причины по компонентам, миграциям и копиям", async () => {
    const snapshot = await health([])
    expect(
      healthAlertReasons({
        ...snapshot,
        checks: { ...snapshot.checks, migrations: false },
        components: {
          ...snapshot.components,
          redis: { status: "down", adapter: "redis", latencyMs: 1 },
          mail: { status: "down", adapter: "smtp", latencyMs: 2 }
        },
        backups: {
          database: { status: "overdue", lastSuccessAt: null, ageSeconds: 1, maxAgeSeconds: 1 },
          media: { status: "unknown", lastSuccessAt: null, ageSeconds: null, maxAgeSeconds: 1 }
        }
      })
    ).toEqual([
      "migrations.incomplete",
      "component.redis.down",
      "component.mail.down",
      "backup.database.overdue",
      "backup.media.unknown"
    ])
  })
})
