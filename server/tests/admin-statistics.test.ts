import { describe, expect, it, vi } from "vitest"
import { createApiError } from "../src/errors/graphql-error"
import type { GraphQLContext } from "../src/prisma"
import {
  exportStatisticsCsv,
  getAiStatistics,
  getContentStatistics,
  getGrowthStatistics
} from "../src/admin/statistics"

type ServiceRole = "editor" | "moderator" | "analyst" | "admin" | "owner"

const NOW = new Date("2026-09-29T12:00:00.000Z")

function context(role: ServiceRole) {
  const auditCreate = vi.fn().mockResolvedValue({})
  const enforce = vi.fn().mockResolvedValue({ allowed: true, remaining: 9, retryAfter: 3_600 })
  const ctx = {
    currentUser: {
      id: `${role}-1`,
      role,
      archivedAt: null,
      planTier: "free",
      planUntil: null,
      permissionExceptions: []
    },
    requestId: "req-statistics",
    logger: { log: vi.fn() },
    prisma: {
      user: {
        findMany: vi.fn().mockResolvedValue([
          { id: "reader-1", createdAt: new Date("2026-09-03T10:00:00.000Z"), sessions: [{ id: "session-1" }] },
          { id: "author-1", createdAt: new Date("2026-09-10T10:00:00.000Z"), sessions: [] }
        ])
      },
      planGrant: {
        findMany: vi.fn().mockResolvedValue([{ userId: "author-1" }])
      },
      article: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "article-1",
            authorId: "author-1",
            title: "Первый материал",
            slug: "first-article",
            section: { id: "section-1", name: "Культура" },
            author: { id: "author-1", name: "Анна Автор", handle: "anna" },
            bookmarks: [{ userId: "reader-1", createdAt: new Date("2026-09-20T10:00:00.000Z") }],
            translations: [
              {
                id: "translation-1",
                locale: "ru",
                status: "published",
                publishedAt: new Date("2026-09-12T10:00:00.000Z"),
                createdAt: new Date("2026-09-05T10:00:00.000Z"),
                revisions: [{ id: "revision-1", createdAt: new Date("2026-09-11T07:00:00.000Z") }],
                reviewMessages: [
                  { kind: "submitted", createdAt: new Date("2026-09-11T08:00:00.000Z") },
                  { kind: "manual_publish", createdAt: new Date("2026-09-12T10:00:00.000Z") }
                ]
              },
              {
                id: "translation-2",
                locale: "en",
                status: "draft",
                publishedAt: null,
                createdAt: new Date("2026-09-06T10:00:00.000Z"),
                revisions: [],
                reviewMessages: []
              }
            ]
          },
          {
            id: "article-2",
            authorId: "author-1",
            title: "Второй материал",
            slug: "second-article",
            section: { id: "section-1", name: "Культура" },
            author: { id: "author-1", name: "Анна Автор", handle: "anna" },
            bookmarks: [],
            translations: [
              {
                id: "translation-3",
                locale: "ru",
                status: "review",
                publishedAt: null,
                createdAt: new Date("2026-09-15T10:00:00.000Z"),
                revisions: [],
                reviewMessages: [{ kind: "submitted", createdAt: new Date("2026-09-15T10:00:00.000Z") }]
              }
            ]
          }
        ])
      },
      aiProcess: {
        findMany: vi.fn().mockImplementation((args) =>
          args.where?.verdict === "reject"
            ? Promise.resolve([
                {
                  objectId: "translation-1",
                  revisionId: "revision-1",
                  createdAt: new Date("2026-09-11T09:00:00.000Z"),
                  finishedAt: new Date("2026-09-11T09:01:00.000Z")
                }
              ])
            : Promise.resolve([
                {
                  kind: "check",
                  status: "completed",
                  durationMs: 1_000,
                  objectType: "ArticleTranslation",
                  objectId: "translation-1"
                },
                {
                  kind: "check",
                  status: "failed",
                  durationMs: 99_000,
                  objectType: "ArticleTranslation",
                  objectId: "translation-2"
                },
                {
                  kind: "alt",
                  status: "completed",
                  durationMs: 3_000,
                  objectType: "mediaAsset",
                  objectId: "asset-1"
                },
                {
                  kind: "translate",
                  status: "completed",
                  durationMs: 5_000,
                  objectType: "ArticleTranslation",
                  objectId: "service-translation"
                }
              ])
        )
      },
      articleTranslation: {
        findMany: vi.fn().mockResolvedValue([{ id: "translation-1" }, { id: "translation-2" }])
      },
      mediaAsset: {
        findMany: vi.fn().mockResolvedValue([{ id: "asset-1" }])
      },
      aiCostAggregate: {
        findMany: vi.fn().mockResolvedValue([
          { kind: "check", totalCostMinor: 120n, processCount: 1 },
          { kind: "translate", totalCostMinor: 80n, processCount: 1 }
        ])
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([]),
        create: auditCreate
      }
    },
    requestMeta: { ip: "127.0.0.1", userAgent: null },
    rateLimiter: { enforce }
  } as unknown as GraphQLContext

  return { ctx, auditCreate, enforce }
}

describe("статистика роста", () => {
  it.each(["analyst", "admin", "owner"] as const)(
    "доступна роли %s и исключает служебные и тестовые записи",
    async (role) => {
      const { ctx } = context(role)

      const result = await getGrowthStatistics(ctx, { period: "DAYS_30" }, NOW)

      expect(result).toMatchObject({
        range: { from: "2026-08-31T12:00:00.000Z", to: "2026-09-29T12:00:00.000Z" },
        registrations: 2,
        activeAccounts: 1,
        enabledAuthors: 1,
        authorsWithPublications: 1
      })
      expect(result.daily).toEqual([
        { date: "2026-09-03", registrations: 1, publications: 0 },
        { date: "2026-09-10", registrations: 1, publications: 0 },
        { date: "2026-09-12", registrations: 0, publications: 1 }
      ])
      expect(ctx.prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isServiceAccount: false,
            isTestAccount: false,
            email: { not: { endsWith: "@example.test" } }
          })
        })
      )
      expect(ctx.prisma.article.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            author: {
              isServiceAccount: false,
              isTestAccount: false,
              email: { not: { endsWith: "@example.test" } }
            }
          })
        })
      )
    }
  )

  it.each(["editor", "moderator"] as const)("не выполняет запросы для роли %s", async (role) => {
    const { ctx } = context(role)
    ctx.currentUser!.permissionExceptions = [
      { id: "grant-finance", permission: "finance", kind: "grant", expiresAt: null, revokedAt: null }
    ] as never

    await expect(getGrowthStatistics(ctx, { period: "DAYS_30" }, NOW)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN", action: "stats.read" }
    })
    expect(ctx.prisma.user.findMany).not.toHaveBeenCalled()
  })

  it("не выполняет запросы для архивированного аналитика", async () => {
    const { ctx } = context("analyst")
    ctx.currentUser!.archivedAt = new Date("2026-09-20T10:00:00.000Z")

    await expect(getGrowthStatistics(ctx, { period: "DAYS_30" }, NOW)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN", action: "stats.read" }
    })
    expect(ctx.prisma.user.findMany).not.toHaveBeenCalled()
  })

  it("проверяет обе границы произвольного периода", async () => {
    const { ctx } = context("analyst")

    await expect(getGrowthStatistics(ctx, { period: "CUSTOM", from: "2026-09-01" }, NOW)).rejects.toMatchObject({
      extensions: { code: "VALIDATION_ERROR", field: "to" }
    })
  })
})

describe("статистика контента", () => {
  it("считает очередь, медиану решения, долю ручных публикаций и топ-таблицы", async () => {
    const { ctx } = context("admin")

    const result = await getContentStatistics(ctx, { period: "DAYS_30" }, NOW)

    expect(result).toMatchObject({
      publications: 1,
      drafts: 1,
      queueSize: 1,
      oldestQueueAgeHours: 338,
      medianDecisionHours: 26,
      rejectionRate: 0,
      manualOverrideRate: 1
    })
    expect(result.byLocale).toEqual([
      { key: "en", count: 0 },
      { key: "ru", count: 1 }
    ])
    expect(result.bySection).toEqual([{ key: "section-1", label: "Культура", count: 1 }])
    expect(result.topAuthors).toEqual([
      {
        id: "author-1",
        name: "Анна Автор",
        handle: "anna",
        publications: 1,
        qualifiedReads: null,
        saves: 1
      }
    ])
    expect(result.topArticles[0]).toMatchObject({
      id: "article-1",
      title: "Первый материал",
      authorName: "Анна Автор",
      qualifiedReads: null,
      saves: 1,
      totalScore: null
    })
    expect(ctx.prisma.article.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          bookmarks: {
            where: expect.objectContaining({
              createdAt: {
                gte: new Date("2026-08-31T12:00:00.000Z"),
                lte: new Date("2026-09-29T12:00:00.000Z")
              },
              user: {
                isServiceAccount: false,
                isTestAccount: false,
                email: { not: { endsWith: "@example.test" } }
              }
            }),
            select: { userId: true, createdAt: true }
          }
        })
      })
    )
  })

  it("не считает ручную публикацию override после reject другой ревизии", async () => {
    const { ctx } = context("admin")
    vi.mocked(ctx.prisma.aiProcess.findMany).mockResolvedValue([
      {
        objectId: "translation-1",
        revisionId: "revision-other",
        createdAt: new Date("2026-09-11T09:00:00.000Z"),
        finishedAt: new Date("2026-09-11T09:01:00.000Z")
      }
    ] as never)

    const result = await getContentStatistics(ctx, { period: "DAYS_30" }, NOW)

    expect(result.manualOverrideRate).toBe(0)
  })

  it("не считает ручную публикацию override, если reject завершился позднее решения", async () => {
    const { ctx } = context("admin")
    vi.mocked(ctx.prisma.aiProcess.findMany).mockResolvedValue([
      {
        objectId: "translation-1",
        revisionId: "revision-1",
        createdAt: new Date("2026-09-12T09:00:00.000Z"),
        finishedAt: new Date("2026-09-12T11:00:00.000Z")
      }
    ] as never)

    const result = await getContentStatistics(ctx, { period: "DAYS_30" }, NOW)

    expect(result.manualOverrideRate).toBe(0)
  })
})

describe("статистика AI", () => {
  it("не включает ошибочные процессы в среднюю длительность и возвращает агрегированную стоимость", async () => {
    const { ctx } = context("owner")

    const result = await getAiStatistics(ctx, { period: "DAYS_30" }, NOW)

    expect(result).toMatchObject({ total: 3, failed: 1, failureRate: 1 / 3, averageDurationMs: 2_000 })
    expect(result.byKind).toEqual([
      { key: "alt", count: 1 },
      { key: "check", count: 2 }
    ])
    expect(result.byStatus).toEqual([
      { key: "completed", count: 2 },
      { key: "failed", count: 1 }
    ])
    expect(result.costMinor).toBe("200")
    expect(ctx.prisma.aiCostAggregate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          bucketStart: { gte: new Date("2026-08-31T12:00:00.000Z") },
          bucketEnd: { lte: new Date("2026-09-29T12:00:00.000Z") }
        }
      })
    )
  })

  it("включает суточный cost bucket последнего дня произвольного периода", async () => {
    const { ctx } = context("owner")

    await getAiStatistics(ctx, { period: "CUSTOM", from: "2026-09-01", to: "2026-09-01" }, NOW)

    expect(ctx.prisma.aiCostAggregate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          bucketStart: { gte: new Date("2026-09-01T00:00:00.000Z") },
          bucketEnd: { lte: new Date("2026-09-02T00:00:00.000Z") }
        }
      })
    )
  })
})

describe("экспорт статистики", () => {
  it("отдаёт агрегированный CSV аналитику и пишет stats.export без идентификаторов пользователей", async () => {
    const { ctx, auditCreate, enforce } = context("analyst")

    const result = await exportStatisticsCsv(ctx, { tab: "GROWTH", range: { period: "DAYS_30" } }, NOW)

    expect(result.filename).toBe("statistics-growth-2026-09-29.csv")
    expect(result.csv).toContain("metric,value")
    expect(result.csv).toContain("registrations,2")
    expect(result.csv).toContain("daily.2026-09-12.publications,1")
    expect(result.csv).not.toContain("reader-1")
    expect(result.csv).not.toContain("author-1")
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "stats.export",
        actorId: "analyst-1",
        actorRole: "analyst",
        entityType: "statistics",
        entityId: "growth",
        diff: expect.objectContaining({ tab: "growth", period: "DAYS_30" })
      })
    })
    expect(enforce).toHaveBeenCalledWith("admin.export.user", "analyst-1", {
      requestId: "req-statistics",
      ip: "127.0.0.1"
    })
  })

  it("возвращает RATE_LIMITED после десяти экспортов в час и не пишет аудит повторно", async () => {
    const { ctx, auditCreate } = context("admin")
    vi.mocked(ctx.rateLimiter.enforce).mockRejectedValue(
      createApiError("RATE_LIMITED", { requestId: "req-statistics", retryAfter: 3_591 })
    )

    await expect(exportStatisticsCsv(ctx, { tab: "CONTENT", range: { period: "DAYS_30" } }, NOW)).rejects.toMatchObject(
      {
        extensions: { code: "RATE_LIMITED", requestId: "req-statistics", retryAfter: 3_591 }
      }
    )
    expect(auditCreate).not.toHaveBeenCalled()
  })
})
