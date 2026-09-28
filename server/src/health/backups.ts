import { throttleAsync } from "./throttle"

/**
 * Возраст последней успешной резервной копии базы и медиа — компонент состояния системы и
 * основание оповещения при просрочке (`85-media-and-binary/backups.md` §5, журнал §29.9,
 * `80-observability/health-and-alerts.md` п. 1, 6).
 *
 * Сами копии делает эксплуатация вне продукта (управляемый PostgreSQL и `pg_dump`, версионирование
 * и синхронизация бакета медиа — `backups.md` п. 1–2). Продукт копии не создаёт и не проверяет их
 * содержимое: он читает отметки прогонов, которые ставит задание копирования
 * (`server/scripts/record-backup.ts`).
 */
export const BACKUP_KINDS = ["database", "media"] as const
export type BackupKindName = (typeof BACKUP_KINDS)[number]

/**
 * `disabled` — отметок нет и наблюдение не требуется (копии приходят вместе с хостингом, журнал
 * §34 п. 1); `unknown` — отметок нет там, где копии обязаны быть; `overdue` — последняя успешная
 * копия старше порога.
 */
export type BackupStatus = "ok" | "overdue" | "unknown" | "disabled"

export interface BackupState {
  status: BackupStatus
  lastSuccessAt: string | null
  ageSeconds: number | null
  maxAgeSeconds: number
}

export type Backups = Record<BackupKindName, BackupState>

const HOUR_SECONDS = 3600

/**
 * `[ДОПУЩЕНИЕ]` Порог просрочки равен объявленной периодичности копий
 * (`docs/vision/08-operations.md` §5 — база ежедневно, медиа еженедельно). Своих числовых правил
 * проход не вводит: и периодичность, и порог спецификация помечает допущением
 * (`backups.md` §6, `health-and-alerts.md` §6). Переопределяется переменными окружения.
 */
export const DEFAULT_BACKUP_MAX_AGE_SECONDS: Record<BackupKindName, number> = {
  database: 24 * HOUR_SECONDS,
  media: 7 * 24 * HOUR_SECONDS
}

const MAX_AGE_ENV_KEYS: Record<BackupKindName, string> = {
  database: "BACKUP_DATABASE_MAX_AGE_HOURS",
  media: "BACKUP_MEDIA_MAX_AGE_HOURS"
}

type BackupEnv = Readonly<Record<string, string | undefined>>

export function readBackupMaxAgeSeconds(env: BackupEnv): Record<BackupKindName, number> {
  const result = { ...DEFAULT_BACKUP_MAX_AGE_SECONDS }
  for (const kind of BACKUP_KINDS) {
    const raw = env[MAX_AGE_ENV_KEYS[kind]]
    if (raw === undefined || raw === "") continue
    const hours = Number(raw)
    if (!Number.isFinite(hours) || hours <= 0) throw new Error(`${MAX_AGE_ENV_KEYS[kind]} must be a positive number`)
    result[kind] = Math.round(hours * HOUR_SECONDS)
  }
  return result
}

export const disabledBackups = (
  maxAgeSeconds: Record<BackupKindName, number> = DEFAULT_BACKUP_MAX_AGE_SECONDS
): Backups => ({
  database: { status: "disabled", lastSuccessAt: null, ageSeconds: null, maxAgeSeconds: maxAgeSeconds.database },
  media: { status: "disabled", lastSuccessAt: null, ageSeconds: null, maxAgeSeconds: maxAgeSeconds.media }
})

interface BackupRunGroup {
  kind: BackupKindName
  status: string
  _max: { completedAt: Date | null }
}

/**
 * Одна группировка вместо двух выборок: последняя отметка каждого вида и состояния сразу говорит и
 * возраст успешной копии, и начала ли эксплуатация вообще ставить отметки.
 */
export interface BackupRunsClient {
  backupRun: {
    groupBy(args: { by: readonly ["kind", "status"]; _max: { completedAt: true } }): Promise<readonly BackupRunGroup[]>
  }
}

export interface BackupMonitorOptions {
  client: BackupRunsClient
  maxAgeSeconds?: Record<BackupKindName, number>
  /**
   * Копии обязательны: отсутствие отметок — `unknown` и деградация. В production это так всегда,
   * иначе прод без подтверждённых копий считался бы здоровым.
   */
  required?: boolean
  now?: () => Date
  intervalMs?: number
}

export function createBackupMonitor(options: BackupMonitorOptions): () => Promise<Backups> {
  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_BACKUP_MAX_AGE_SECONDS
  const now = options.now ?? (() => new Date())

  const read = async (): Promise<Backups> => {
    const groups = await options.client.backupRun.groupBy({ by: ["kind", "status"], _max: { completedAt: true } })
    const reported = groups.length > 0
    const at = now().getTime()

    const state = (kind: BackupKindName): BackupState => {
      const limit = maxAgeSeconds[kind]
      const lastSuccess = groups.find((group) => group.kind === kind && group.status === "succeeded")?._max.completedAt
      if (!lastSuccess) {
        return {
          status: options.required || reported ? "unknown" : "disabled",
          lastSuccessAt: null,
          ageSeconds: null,
          maxAgeSeconds: limit
        }
      }
      const ageSeconds = Math.max(0, Math.floor((at - lastSuccess.getTime()) / 1000))
      return {
        status: ageSeconds > limit ? "overdue" : "ok",
        lastSuccessAt: lastSuccess.toISOString(),
        ageSeconds,
        maxAgeSeconds: limit
      }
    }

    return { database: state("database"), media: state("media") }
  }

  return throttleAsync(read, options.intervalMs)
}

export function createBackupMonitorFromEnv(env: BackupEnv, client: BackupRunsClient): () => Promise<Backups> {
  return createBackupMonitor({
    client,
    maxAgeSeconds: readBackupMaxAgeSeconds(env),
    required: env.NODE_ENV === "production"
  })
}
