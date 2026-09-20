import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import type { GraphQLContext } from "../src/prisma"
import type { PermissionException } from "../src/exceptions/permissions"
import {
  DEFAULT_JOB_PERIOD_HOURS,
  JOB_BULK_RETRY_LIMIT,
  cancelAdminJob,
  getAdminJob,
  getJobsSummary,
  isRetryable,
  listAdminJobs,
  presentParameters,
  retryAdminJob,
  retryAdminJobs
} from "../src/admin/jobs"

const NOW = new Date("2026-09-20T12:00:00.000Z")
type ViewerRole = "editor" | "moderator" | "analyst" | "admin" | "owner"

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    kind: "ai.check",
    status: "failed",
    objectType: "Article",
    objectId: "article-1",
    createdAt: new Date("2026-09-20T11:00:00.000Z"),
    startedAt: new Date("2026-09-20T11:00:10.000Z"),
    finishedAt: new Date("2026-09-20T11:00:25.000Z"),
    cancelledAt: null,
    attemptCount: 3,
    maxAttempts: 3,
    manualRetryAllowed: true,
    attempts: [{ errorClass: "ProviderError", errorRequestId: "req-failed" }],
    ...overrides
  }
}

function context(
  options: {
    role?: ViewerRole
    rows?: ReturnType<typeof job>[]
    total?: number
    exceptions?: PermissionException[]
    retry?: ReturnType<typeof vi.fn>
  } = {}
) {
  const rows = options.rows ?? [job()]
  const jobDelegate = {
    count: vi.fn().mockResolvedValue(options.total ?? rows.length),
    groupBy: vi.fn().mockResolvedValue([{ kind: "ai.check", _count: { _all: 2 } }]),
    findMany: vi.fn().mockResolvedValue(rows),
    findFirst: vi.fn().mockResolvedValue({ createdAt: new Date("2026-09-20T11:30:00.000Z") }),
    findUnique: vi.fn().mockResolvedValue(rows[0] ? { ...rows[0], parameters: { articleId: "article-1" } } : null),
    updateMany: vi.fn().mockResolvedValue({ count: 1 })
  }
  const prisma = {
    job: jobDelegate,
    jobAttempt: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    article: { findUnique: vi.fn().mockResolvedValue({ slug: "article-slug" }) },
    $queryRaw: vi.fn().mockResolvedValue(rows.map((row) => ({ id: row.id }))),
    $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(prisma))
  }
  const role = options.role ?? "admin"
  return {
    ctx: {
      prisma,
      requestId: "req-1",
      currentUser: {
        id: `${role}-1`,
        role,
        archivedAt: null,
        planTier: "free",
        planUntil: null,
        permissionExceptions: options.exceptions ?? []
      }
    } as unknown as GraphQLContext,
    prisma
  }
}

describe("admin jobs section", () => {
  it("открывает список admin и owner и закрывает остальным служебным ролям", async () => {
    for (const role of ["admin", "owner"] as const) {
      const { ctx } = context({ role })
      await expect(listAdminJobs(ctx, {}, NOW)).resolves.toMatchObject({ pagination: { currentPage: 1 } })
    }
    for (const role of ["editor", "moderator", "analyst"] as const) {
      const { ctx } = context({ role })
      await expect(listAdminJobs(ctx, {}, NOW)).rejects.toMatchObject<Partial<GraphQLError>>({
        extensions: { code: "FORBIDDEN" }
      })
    }
  })

  it("по умолчанию показывает ошибку и зависло за последние сутки", async () => {
    const { ctx, prisma } = context()

    const page = await listAdminJobs(ctx, {}, NOW)

    expect(prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["failed", "stuck"] },
          createdAt: { gte: new Date(NOW.getTime() - DEFAULT_JOB_PERIOD_HOURS * 3_600_000), lte: NOW }
        }),
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 20
      })
    )
    expect(page.appliedFrom).toEqual(new Date(NOW.getTime() - DEFAULT_JOB_PERIOD_HOURS * 3_600_000))
    expect(page.appliedTo).toEqual(NOW)
  })

  it("сужает список до зависших по признаку stuck из адреса", async () => {
    const { ctx, prisma } = context()

    await listAdminJobs(ctx, { filters: { statuses: ["completed"], stuckOnly: true } }, NOW)

    expect(prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { in: ["stuck"] } }) })
    )
  })

  it("сортировка по длительности берёт порядок из базы и сохраняет его в выдаче", async () => {
    const rows = [job({ id: "job-short" }), job({ id: "job-long" })]
    const { ctx, prisma } = context({ rows })
    prisma.$queryRaw.mockResolvedValue([{ id: "job-long" }, { id: "job-short" }])

    const page = await listAdminJobs(ctx, { sort: { field: "duration", direction: "DESC" } }, NOW)

    expect(prisma.$queryRaw).toHaveBeenCalledOnce()
    expect(page.jobs.map((row) => row.id)).toEqual(["job-long", "job-short"])
  })

  it("считает длительность и последнюю ошибку строки", async () => {
    const { ctx } = context()

    const [row] = (await listAdminJobs(ctx, {}, NOW)).jobs

    expect(row).toMatchObject({ durationMs: 15_000, lastErrorClass: "ProviderError", lastErrorRequestId: "req-failed" })
  })

  it("не предлагает повтор для расчёта рейтинга и для запрещённого ручного повтора", () => {
    expect(isRetryable({ status: "failed", kind: "ai.check", manualRetryAllowed: true })).toBe(true)
    expect(isRetryable({ status: "stuck", kind: "ai.check", manualRetryAllowed: true })).toBe(true)
    expect(isRetryable({ status: "failed", kind: "ranking.recompute", manualRetryAllowed: true })).toBe(false)
    expect(isRetryable({ status: "failed", kind: "ai.check", manualRetryAllowed: false })).toBe(false)
    expect(isRetryable({ status: "running", kind: "ai.check", manualRetryAllowed: true })).toBe(false)
  })

  it("скрывает действия от admin без исключения и открывает их по индивидуальному праву", async () => {
    const { ctx: adminCtx } = context({ role: "admin" })
    expect((await listAdminJobs(adminCtx, {}, NOW)).viewer).toEqual({ canRetry: false, canCancel: false })

    const { ctx: ownerCtx } = context({ role: "owner" })
    expect((await listAdminJobs(ownerCtx, {}, NOW)).viewer).toEqual({ canRetry: true, canCancel: true })

    const exception: PermissionException = {
      userId: "admin-1",
      role: "admin",
      permission: "job.retry",
      kind: "grant",
      startsAt: new Date("2026-09-19T00:00:00.000Z"),
      endsAt: null,
      revokedAt: null
    }
    const { ctx: grantedCtx } = context({ role: "admin", exceptions: [exception] })
    expect((await listAdminJobs(grantedCtx, {}, NOW)).viewer).toEqual({ canRetry: true, canCancel: false })
  })

  it("отдаёт карточку с параметрами без персональных данных и ссылкой на объект", async () => {
    const { ctx, prisma } = context({ role: "owner" })
    prisma.auditLog.findMany.mockResolvedValue([
      {
        action: "job.cancel",
        actorId: "owner-1",
        actorRole: "owner",
        diff: { jobId: "job-1", kind: "ai.check", reason: "дубль" },
        createdAt: NOW
      }
    ])
    prisma.user.findMany.mockResolvedValue([{ id: "owner-1", name: "Владелец" }])

    const card = await getAdminJob(ctx, "job-1", NOW)

    expect(card?.parameters).toEqual([{ key: "articleId", value: "article-1" }])
    expect(card?.actions).toEqual([
      expect.objectContaining({ action: "job.cancel", actorName: "Владелец", reason: "дубль" })
    ])
    expect(card?.objectHref).toBe("/admin/articles/article-slug")
  })

  it("разворачивает только скалярные параметры задания", () => {
    expect(presentParameters({ id: "a", count: 2, ok: true, nested: { pii: "x" }, list: [1], missing: null })).toEqual([
      { key: "id", value: "a" },
      { key: "count", value: "2" },
      { key: "ok", value: "true" },
      { key: "nested", value: "{…}" },
      { key: "list", value: "[…]" },
      { key: "missing", value: "—" }
    ])
  })

  it("считает глубину очереди, возраст старшего задания и долю ошибок", async () => {
    const { ctx, prisma } = context({ role: "owner" })
    prisma.job.count.mockResolvedValueOnce(4).mockResolvedValueOnce(1)

    const summary = await getJobsSummary(ctx, NOW)

    expect(summary.depthByKind).toEqual([{ kind: "ai.check", depth: 2 }])
    expect(summary.oldestPendingAgeSec).toBe(1_800)
    expect(summary.failureRate).toBe(0.25)
  })

  it("требует право owner на повтор и отмену", async () => {
    const { ctx } = context({ role: "admin" })

    await expect(retryAdminJob(ctx, "job-1", NOW)).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "FORBIDDEN" }
    })
    await expect(cancelAdminJob(ctx, "job-1", "дубль", NOW)).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "FORBIDDEN" }
    })
  })

  it("превращает несовпавшее предусловие в конфликт", async () => {
    const { ctx, prisma } = context({ role: "owner", rows: [job({ status: "completed" })] })
    prisma.job.findUnique.mockResolvedValue({
      status: "completed",
      kind: "ai.check",
      attemptCount: 1,
      manualRetryAllowed: true
    })

    await expect(retryAdminJob(ctx, "job-1", NOW)).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "CONFLICT" }
    })
  })

  it("ограничивает массовый повтор сотней заданий и пропускает конфликтные", async () => {
    const { ctx } = context({ role: "owner" })
    await expect(retryAdminJobs(ctx, [], NOW)).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "VALIDATION_ERROR" }
    })
    const tooMany = Array.from({ length: JOB_BULK_RETRY_LIMIT + 1 }, (_, index) => `job-${index}`)
    await expect(retryAdminJobs(ctx, tooMany, NOW)).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "VALIDATION_ERROR" }
    })

    const { ctx: mixedCtx, prisma } = context({ role: "owner" })
    prisma.job.findUnique
      .mockResolvedValueOnce({ status: "failed", kind: "ai.check", attemptCount: 1, manualRetryAllowed: true })
      .mockResolvedValueOnce({ status: "completed", kind: "ai.check", attemptCount: 1, manualRetryAllowed: true })

    await expect(retryAdminJobs(mixedCtx, ["job-1", "job-2"], NOW)).resolves.toEqual({
      requested: 2,
      retried: ["job-1"],
      skipped: ["job-2"]
    })
  })
})
