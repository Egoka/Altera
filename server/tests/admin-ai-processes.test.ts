import { describe, expect, it } from "vitest"
import { getAdminAiRecord, getAdminAiStats, listAdminAiRecords, normalizeAdminAiQuery } from "../src/admin/ai-processes"
import type { Role } from "../src/generated/prisma"
import type { GraphQLContext } from "../src/prisma"

const now = new Date("2026-09-29T00:00:00.000Z")

const actor = (role: Role) => ({
  id: `${role}-1`,
  role,
  archivedAt: null,
  planTier: "free" as const,
  planUntil: null,
  permissionExceptions: []
})

const context = (role: Role, prisma: object): GraphQLContext =>
  ({ currentUser: actor(role), prisma, requestId: "req-ai-1" }) as unknown as GraphQLContext

const process = (overrides: Record<string, unknown> = {}) => ({
  id: "process-visible",
  jobId: "job-visible",
  kind: "check",
  status: "completed",
  objectType: "ArticleTranslation",
  objectId: "translation-visible",
  verdict: "reject",
  reasons: { categories: ["spam_ads"], details: { spam_ads: "Рекламная подача" } },
  providerErrorClass: null,
  model: "fake-check",
  promptVersion: "check-v1",
  createdAt: new Date("2026-09-28T20:00:00.000Z"),
  startedAt: new Date("2026-09-28T20:00:01.000Z"),
  finishedAt: new Date("2026-09-28T20:00:03.000Z"),
  durationMs: 2_000,
  ...overrides
})

const translation = {
  id: "translation-visible",
  title: "Видимый материал",
  slug: "visible-story",
  locale: "ru",
  article: { id: "article-visible", slug: "visible-story", status: "review" }
}

describe("административная история AI-процессов", () => {
  it("нормализует период в семь дней и отклоняет поиск короче трёх знаков", () => {
    const normalized = normalizeAdminAiQuery({}, "req-ai-1", now)

    expect(normalized.page).toBe(1)
    expect(normalized.limit).toBe(20)
    expect(normalized.from).toEqual(new Date("2026-09-22T00:00:00.000Z"))
    expect(normalized.to).toEqual(now)
    expect(() => normalizeAdminAiQuery({ filters: { query: "ai" } }, "req-ai-1", now)).toThrow()
  })

  it("не открывает раздел обычному аккаунту и редактору", async () => {
    for (const role of ["reader", "editor"] as const) {
      await expect(listAdminAiRecords(context(role, {}), {}, now)).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN", action: "admin.ai.read" }
      })
    }
  })

  it("модератор получает только процессы материалов своей очереди", async () => {
    const hidden = process({ id: "process-hidden", objectId: "translation-hidden" })
    const prisma = {
      articleTranslation: {
        findMany: async (args: { where?: object; select?: object }) => {
          if (args.where && "article" in args.where) return [{ id: translation.id }]
          return [translation]
        }
      },
      user: { findMany: async () => [] },
      mediaAsset: { findMany: async () => [] },
      aiProcess: {
        count: async () => 1,
        findMany: async (args: { where: { AND?: Array<Record<string, unknown>> } }) => {
          const scoped = args.where.AND?.find((condition) => condition.objectId)
          const ids = (scoped?.objectId as { in?: string[] } | undefined)?.in ?? []
          return [process(), hidden].filter((item) => ids.includes(item.objectId))
        }
      }
    }

    const result = await listAdminAiRecords(context("moderator", prisma), {}, now)

    expect(result.items.map(({ id }) => id)).toEqual(["process-visible"])
    expect(result.items[0]?.object).toEqual({
      id: "translation-visible",
      type: "ArticleTranslation",
      title: "Видимый материал",
      subtitle: "ru",
      href: "/admin/articles/visible-story"
    })
  })

  it("карточка явно проектирует безопасные поля без стоимости отдельной записи", async () => {
    const prisma = {
      articleTranslation: { findMany: async () => [translation] },
      user: { findMany: async () => [] },
      mediaAsset: { findMany: async () => [] },
      aiProcess: { findFirst: async () => ({ ...process(), costMinor: 999 }) }
    }

    const card = await getAdminAiRecord(context("analyst", prisma), "process-visible")

    expect(card).toMatchObject({
      id: "process-visible",
      reasons: [{ category: "spam_ads", text: "Рекламная подача" }],
      jobHref: null
    })
    expect(card).not.toHaveProperty("costMinor")
  })

  it("агрегаты доступны аналитику, но не модератору", async () => {
    const prisma = {
      aiProcess: {
        count: async () => 4,
        groupBy: async ({ by }: { by: string[] }) =>
          by[0] === "kind"
            ? [{ kind: "check", _count: { _all: 4 } }]
            : [
                { status: "completed", _count: { _all: 3 } },
                { status: "failed", _count: { _all: 1 } }
              ],
        findMany: async () => [
          { durationMs: 100, reasons: { categories: [] }, providerErrorClass: null },
          { durationMs: 300, reasons: { categories: ["spam_ads"] }, providerErrorClass: null },
          { durationMs: 500, reasons: { categories: ["spam_ads", "illegal"] }, providerErrorClass: null },
          { durationMs: null, reasons: null, providerErrorClass: "PROVIDER_UNAVAILABLE" }
        ]
      },
      aiCostAggregate: {
        aggregate: async () => ({ _sum: { totalCostMinor: 1_250n, processCount: 4 } })
      }
    }

    await expect(getAdminAiStats(context("moderator", prisma), {}, now)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN", action: "admin.ai.stats" }
    })

    const stats = await getAdminAiStats(context("analyst", prisma), {}, now)
    expect(stats).toMatchObject({
      processCount: 4,
      totalCostMinor: "1250",
      medianDurationMs: 300,
      planSharePercent: null,
      providerErrors: 1,
      rejectionReasons: [
        { category: "spam_ads", count: 2, share: 0.5 },
        { category: "illegal", count: 1, share: 0.25 }
      ]
    })
  })
})
