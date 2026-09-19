import { describe, expect, it, vi } from "vitest"
import {
  AUDIT_CSV_COLUMNS,
  AUDIT_EXPORT_LIMIT_PER_HOUR,
  buildAuditCsv,
  exportAuditCsv,
  getAuditEntry,
  getAuditSummary,
  listAuditLog
} from "../src/admin/audit"
import { AUDIT_EVENT_CODES, auditCodesForZone } from "../src/audit/registry"
import type { GraphQLContext } from "../src/prisma"

type Role = "editor" | "moderator" | "analyst" | "admin" | "owner" | "author"

const NOW = new Date("2026-09-20T12:00:00.000Z")

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "audit-1",
  action: "translation.unpublish",
  actorId: "moderator-1",
  actorRole: "moderator",
  entityType: "articleTranslation",
  entityId: "translation-1",
  diff: { reason: "policy", before: "published" },
  subject: null,
  context: null,
  purpose: null,
  requestId: "req-1",
  createdAt: new Date("2026-09-20T10:00:00.000Z"),
  ...overrides
})

interface ContextOptions {
  rows?: ReturnType<typeof row>[]
  entry?: ReturnType<typeof row> | null
  recentExports?: { createdAt: Date }[]
}

function context(role: Role, options: ContextOptions = {}) {
  const auditFindMany = vi
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve(where?.action === "stats.export" ? (options.recentExports ?? []) : (options.rows ?? []))
    )
  const auditCreate = vi.fn().mockResolvedValue({})
  const ctx = {
    currentUser: { id: `${role}-1`, role, archivedAt: null, planTier: "free", planUntil: null },
    requestId: "req-audit",
    logger: { log: vi.fn() },
    prisma: {
      auditLog: {
        findMany: auditFindMany,
        findUnique: vi.fn().mockResolvedValue(options.entry ?? null),
        create: auditCreate,
        groupBy: vi.fn().mockResolvedValue([])
      },
      user: { findMany: vi.fn().mockResolvedValue([{ id: "moderator-1", name: "Мод Модератор" }]) }
    }
  } as unknown as GraphQLContext

  return { ctx, auditFindMany, auditCreate }
}

describe("зонная видимость аудита", () => {
  it.each([
    ["editor", "editorial"],
    ["moderator", "moderation"],
    ["analyst", "financeAndPd"]
  ] as const)("служебная роль %s получает только коды своей зоны", async (role, zone) => {
    const { ctx, auditFindMany } = context(role, { rows: [row()] })

    const page = await listAuditLog(ctx, {}, {}, NOW)

    expect(page.zone).toBe(zone)
    expect(auditFindMany.mock.calls[0][0].where.action).toEqual({ in: auditCodesForZone(zone) })
    expect(page.canExport).toBe(false)
    // Список кодов для фильтра приходит из реестра, а не из содержимого выдачи.
    expect(page.availableActions).toEqual([...auditCodesForZone(zone)].sort())
  })

  it.each(["admin", "owner"] as const)("%s видит весь журнал без зонного фильтра", async (role) => {
    const { ctx, auditFindMany } = context(role, { rows: [row()] })

    const page = await listAuditLog(ctx, {}, {}, NOW)

    expect(page.zone).toBeNull()
    expect(auditFindMany.mock.calls[0][0].where.action).toBeUndefined()
    expect(page.canExport).toBe(true)
    expect(page.availableActions).toEqual([...AUDIT_EVENT_CODES].sort())
  })

  it("не расширяет видимость служебной роли запросом чужой зоны", async () => {
    const { ctx, auditFindMany } = context("editor", { rows: [] })

    const page = await listAuditLog(ctx, { zone: "financeAndPd" }, {}, NOW)

    expect(page.zone).toBe("editorial")
    expect(auditFindMany.mock.calls[0][0].where.action).toEqual({ in: auditCodesForZone("editorial") })
  })

  it("возвращает пустую выдачу для кода вне зоны вместо чужих записей", async () => {
    const { ctx, auditFindMany } = context("editor", { rows: [] })

    await listAuditLog(ctx, { action: "payment.refund" }, {}, NOW)

    expect(auditFindMany.mock.calls[0][0].where.action).toEqual({ in: [] })
  })

  it("закрывает код без зоны от служебных ролей", () => {
    for (const zone of ["editorial", "moderation", "financeAndPd"] as const) {
      expect(auditCodesForZone(zone)).not.toContain("settings.change")
    }
  })

  it("обычный аккаунт получает FORBIDDEN", async () => {
    const { ctx } = context("author")

    await expect(listAuditLog(ctx, {}, {}, NOW)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN", action: "audit.read" }
    })
  })

  it("без сессии отвечает UNAUTHENTICATED", async () => {
    const { ctx } = context("admin")
    Reflect.set(ctx, "currentUser", null)

    await expect(listAuditLog(ctx, {}, {}, NOW)).rejects.toMatchObject({ extensions: { code: "UNAUTHENTICATED" } })
  })
})

describe("фильтры и пагинация аудита", () => {
  it("по умолчанию берёт период 7 дней и лимит 20", async () => {
    const { ctx, auditFindMany } = context("admin", { rows: [row()] })

    await listAuditLog(ctx, {}, {}, NOW)

    const call = auditFindMany.mock.calls[0][0]
    expect(call.take).toBe(21)
    expect(call.where.createdAt).toEqual({ gte: new Date("2026-09-13T12:00:00.000Z") })
    expect(call.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }])
  })

  it("переносит фильтры актора, сущности, субъекта и requestId в запрос", async () => {
    const { ctx, auditFindMany } = context("admin", { rows: [] })

    await listAuditLog(
      ctx,
      {
        action: "admin.read.personal",
        actorId: "analyst-9",
        entityType: "user",
        entityId: "user-42",
        subject: "user-42",
        requestId: "req-source",
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-19T00:00:00.000Z"
      },
      {},
      NOW
    )

    expect(auditFindMany.mock.calls[0][0].where).toMatchObject({
      action: "admin.read.personal",
      actorId: "analyst-9",
      entityType: "user",
      entityId: "user-42",
      subject: "user-42",
      requestId: "req-source",
      createdAt: { gte: new Date("2026-09-01T00:00:00.000Z"), lte: new Date("2026-09-19T00:00:00.000Z") }
    })
  })

  it("фильтр «система» ищет записи без актора", async () => {
    const { ctx, auditFindMany } = context("admin", { rows: [] })

    await listAuditLog(ctx, { actorSystem: true, actorId: "admin-1" }, {}, NOW)

    expect(auditFindMany.mock.calls[0][0].where.actorId).toBeNull()
  })

  it("отдаёт курсор следующей страницы и раскрывает системного актора как «система»", async () => {
    const rows = [
      row({ id: "a", createdAt: new Date("2026-09-20T10:00:00.000Z") }),
      row({ id: "b", actorId: null, actorRole: null, action: "ai.decision" })
    ]
    const { ctx } = context("admin", { rows })

    const page = await listAuditLog(ctx, {}, { limit: 1 }, NOW)

    expect(page.entries).toHaveLength(1)
    expect(page.nextCursor).toBe("2026-09-20T10:00:00.000Z|a")
    expect(page.entries[0].actor).toEqual({
      id: "moderator-1",
      role: "moderator",
      name: "Мод Модератор",
      isSystem: false
    })
    expect(page.entries[0].changedFields).toEqual(["reason", "before"])
  })

  it("применяет курсор как пару времени и идентификатора", async () => {
    const { ctx, auditFindMany } = context("admin", { rows: [] })

    await listAuditLog(ctx, {}, { cursor: "2026-09-20T10:00:00.000Z|a" }, NOW)

    expect(auditFindMany.mock.calls[0][0].where.OR).toEqual([
      { createdAt: { lt: new Date("2026-09-20T10:00:00.000Z") } },
      { createdAt: new Date("2026-09-20T10:00:00.000Z"), id: { lt: "a" } }
    ])
  })

  it.each([0, 101, 1.5])("отклоняет лимит %s", async (limit) => {
    const { ctx } = context("admin")

    await expect(listAuditLog(ctx, {}, { limit }, NOW)).rejects.toMatchObject({
      extensions: { code: "VALIDATION_ERROR", field: "limit", rule: "1-100" }
    })
  })

  it("отклоняет неразборный курсор и неизвестную зону", async () => {
    const { ctx } = context("admin")

    await expect(listAuditLog(ctx, {}, { cursor: "broken" }, NOW)).rejects.toMatchObject({
      extensions: { code: "VALIDATION_ERROR", field: "cursor" }
    })
    await expect(listAuditLog(ctx, { zone: "unknown" }, {}, NOW)).rejects.toMatchObject({
      extensions: { code: "VALIDATION_ERROR", field: "zone" }
    })
  })
})

describe("карточка записи", () => {
  it("отдаёт diff, субъект, контекст и цель записи своей зоны", async () => {
    const entry = row({
      action: "admin.read.personal",
      actorId: "analyst-1",
      actorRole: "analyst",
      subject: "user-42",
      context: "/admin/users/user-42",
      purpose: "user.card.open"
    })
    const { ctx } = context("analyst", { entry })

    const detail = await getAuditEntry(ctx, "audit-1")

    expect(detail).toMatchObject({
      subject: "user-42",
      context: "/admin/users/user-42",
      purpose: "user.card.open",
      diff: { reason: "policy", before: "published" },
      requestId: "req-1"
    })
  })

  it("отвечает NOT_FOUND на запись вне зоны служебной роли", async () => {
    const { ctx } = context("editor", { entry: row({ action: "payment.refund" }) })

    await expect(getAuditEntry(ctx, "audit-1")).rejects.toMatchObject({
      extensions: { code: "NOT_FOUND", entity: "auditEntry" }
    })
  })

  it("отвечает NOT_FOUND на несуществующую запись", async () => {
    const { ctx } = context("owner", { entry: null })

    await expect(getAuditEntry(ctx, "missing")).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } })
  })
})

// Критерий 2 задачи и журнал §27.5 п. 5: просмотр аудита не создаёт записей.
describe("просмотр аудита не аудируется", () => {
  it("ни список, ни карточка, ни сводка не пишут в журнал", async () => {
    const { ctx, auditCreate } = context("owner", { rows: [row()], entry: row() })

    await listAuditLog(ctx, {}, {}, NOW)
    await getAuditEntry(ctx, "audit-1")
    await getAuditSummary(ctx, {}, NOW)

    expect(auditCreate).not.toHaveBeenCalled()
    expect(ctx.logger.log).not.toHaveBeenCalled()
  })
})

describe("экспорт CSV", () => {
  it.each(["editor", "moderator", "analyst"] as const)("%s экспортировать не может", async (role) => {
    const { ctx, auditCreate } = context(role)

    await expect(exportAuditCsv(ctx, {}, NOW)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN", action: "stats.export" }
    })
    expect(auditCreate).not.toHaveBeenCalled()
  })

  it.each(["admin", "owner"] as const)("%s получает файл и ровно одну запись stats.export", async (role) => {
    const { ctx, auditCreate } = context(role, { rows: [row()] })

    const result = await exportAuditCsv(ctx, {}, NOW)

    expect(result.filename).toBe("audit-2026-09-20.csv")
    expect(result.rows).toBe(1)
    expect(auditCreate).toHaveBeenCalledOnce()
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({
      action: "stats.export",
      actorId: `${role}-1`,
      actorRole: role,
      entityType: "auditLog",
      diff: { report: "audit", rows: 1 }
    })
  })

  it("в CSV нет полей с персональными данными", async () => {
    const rows = [
      row({
        action: "admin.read.personal",
        actorId: "analyst-1",
        actorRole: "analyst",
        entityType: "user",
        entityId: "user-42",
        subject: "user-42",
        context: "/admin/users/user-42",
        purpose: "user.card.open",
        diff: { email: "alice@example.test" }
      })
    ]
    const { ctx } = context("admin", { rows })

    const result = await exportAuditCsv(ctx, {}, NOW)

    expect(result.csv.split("\n")[0]).toBe(AUDIT_CSV_COLUMNS.join(","))
    for (const forbidden of ["analyst-1", "user-42", "/admin/users/user-42", "user.card.open", "alice@example.test"]) {
      expect(result.csv).not.toContain(forbidden)
    }
    expect(result.csv).toContain("2026-09-20T10:00:00.000Z,admin.read.personal,analyst,staff,user,req-1")
  })

  it("отмечает автоматическую запись как system и экранирует запятые", () => {
    const csv = buildAuditCsv([
      row({ actorId: null, actorRole: null, action: "ai.decision", entityType: "articleTranslation,x" })
    ])

    expect(csv).toContain(',ai.decision,,system,"articleTranslation,x",req-1')
  })

  it("превышение лимита экспорта даёт RATE_LIMITED с retryAfter", async () => {
    const recentExports = Array.from({ length: AUDIT_EXPORT_LIMIT_PER_HOUR }, (_, index) => ({
      createdAt: new Date(NOW.getTime() - (30 - index) * 60_000)
    }))
    const { ctx, auditCreate } = context("admin", { rows: [row()], recentExports })

    await expect(exportAuditCsv(ctx, {}, NOW)).rejects.toMatchObject({
      extensions: { code: "RATE_LIMITED", retryAfter: 1800 }
    })
    expect(auditCreate).not.toHaveBeenCalled()
  })

  it("пропускает экспорт, пока лимит не достигнут", async () => {
    const recentExports = Array.from({ length: AUDIT_EXPORT_LIMIT_PER_HOUR - 1 }, () => ({ createdAt: NOW }))
    const { ctx, auditCreate } = context("admin", { rows: [row()], recentExports })

    await exportAuditCsv(ctx, {}, NOW)

    expect(auditCreate).toHaveBeenCalledOnce()
  })
})

describe("сводка по фильтру", () => {
  it("считает записи по кодам и акторам без персональных данных", async () => {
    const { ctx } = context("admin")
    vi.mocked(ctx.prisma.auditLog.groupBy)
      .mockResolvedValueOnce([
        { action: "plan.grant", _count: { _all: 2 } },
        { action: "stats.export", _count: { _all: 5 } }
      ] as never)
      .mockResolvedValueOnce([
        { actorId: "moderator-1", _count: { _all: 4 } },
        { actorId: null, _count: { _all: 3 } }
      ] as never)

    const summary = await getAuditSummary(ctx, {}, NOW)

    expect(summary.total).toBe(7)
    expect(summary.byAction[0]).toEqual({ key: "stats.export", label: null, count: 5 })
    expect(summary.byActor).toEqual([
      { key: "moderator-1", label: "Мод Модератор", count: 4 },
      { key: "system", label: null, count: 3 }
    ])
  })
})
