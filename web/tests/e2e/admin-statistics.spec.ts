import { expect, test } from "./helpers/test"
import { PrismaClient, type Role } from "../../../server/src/generated/prisma/index.js"
import { createSessionId, signAccessToken } from "./helpers/session-token"

const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
const roles = ["analyst", "moderator"] as const satisfies readonly Role[]
const userIds = { analyst: "t075-analyst", moderator: "t075-moderator" } as const
const sessionIds = {} as Record<(typeof roles)[number], string>

const signToken = (role: (typeof roles)[number]) => signAccessToken(userIds[role], sessionIds[role])

async function upsertUser(role: (typeof roles)[number]) {
  const id = userIds[role]
  const handle = `t075-${role}`
  await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
  await prisma.user.upsert({
    where: { email: `${handle}@example.test` },
    update: { archivedAt: null, isServiceAccount: true, isTestAccount: false, role },
    create: {
      id,
      email: `${handle}@example.test`,
      handle,
      isServiceAccount: true,
      isTestAccount: false,
      name: `T075 ${role}`,
      role
    }
  })
  await prisma.handleHistory.update({ where: { handle }, data: { userId: id } })
  sessionIds[role] = await createSessionId(prisma, id)
}

const growth = {
  range: { from: "2026-08-31T12:00:00.000Z", to: "2026-09-29T12:00:00.000Z" },
  registrations: 12,
  activeAccounts: 8,
  enabledAuthors: 5,
  authorsWithPublications: 3,
  daily: [{ date: "2026-09-12", registrations: 2, publications: 1 }]
}

const content = {
  range: growth.range,
  publications: 4,
  drafts: 6,
  queueSize: 2,
  oldestQueueAgeHours: 18,
  medianDecisionHours: 9.5,
  rejectionRate: 0.25,
  manualOverrideRate: 0.5,
  byLocale: [
    { key: "en", count: 1 },
    { key: "ru", count: 3 }
  ],
  bySection: [{ key: "culture", label: "Культура", count: 4 }],
  topAuthors: [{ id: "author-1", name: "Анна Автор", handle: "anna", publications: 4, qualifiedReads: null, saves: 2 }],
  topArticles: [
    {
      id: "article-1",
      slug: "first",
      title: "Первый материал",
      authorId: "author-1",
      authorName: "Анна Автор",
      publications: 1,
      qualifiedReads: null,
      saves: 2,
      totalScore: null
    }
  ]
}

test.describe("admin statistics", () => {
  test.describe.configure({ mode: "serial" })

  test.beforeAll(async () => {
    for (const role of roles) await upsertUser(role)
  })

  test.afterAll(async () => {
    await prisma.$disconnect()
  })

  test("shows loading, exact growth values and the empty period state", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken("analyst")}` })
    let releaseResponse = () => {}
    let markRequestStarted = () => {}
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve
    })
    let empty = false
    await page.route("**/api/graphql", async (route) => {
      const body = route.request().postDataJSON() as { query?: string }
      if (!body.query?.includes("GetStatisticsGrowth")) return route.continue()
      markRequestStarted()
      await responseGate
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            statisticsGrowth: empty
              ? {
                  ...growth,
                  registrations: 0,
                  activeAccounts: 0,
                  enabledAuthors: 0,
                  authorsWithPublications: 0,
                  daily: []
                }
              : growth
          }
        })
      })
    })

    await page.goto("/admin/statistics?tab=growth&period=30d", { waitUntil: "commit" })
    await requestStarted
    await expect(page.locator("[data-statistics-loading]")).toBeVisible()
    releaseResponse()
    await expect(page.locator('[data-statistic="registrations"]')).toContainText("12")
    await expect(page.locator('[data-statistics-day="2026-09-12"]')).toContainText("2")

    empty = true
    await page.getByLabel("Период").selectOption("7d")
    await expect(page.locator("[data-statistics-empty]")).toBeVisible()
    await expect(page.locator('[data-statistic="registrations"]')).toContainText("0")
  })

  test("keeps content available after a failed growth request", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken("analyst")}` })
    await page.route("**/api/graphql", async (route) => {
      const body = route.request().postDataJSON() as { query?: string }
      if (body.query?.includes("GetStatisticsGrowth")) {
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            errors: [
              { message: "Internal server error", extensions: { code: "INTERNAL_ERROR", requestId: "req-stats" } }
            ]
          })
        })
      }
      if (body.query?.includes("GetStatisticsContent")) {
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ data: { statisticsContent: content } })
        })
      }
      return route.continue()
    })

    await page.goto("/admin/statistics?tab=growth&period=30d")
    await expect(page.locator("[data-statistics-error]")).toContainText("requestId: req-stats")
    await page.getByRole("button", { name: "Контент" }).click()
    await expect(page.locator('[data-statistic="publications"]')).toContainText("4")
    await expect(page.getByText("Анна Автор").first()).toBeVisible()
    await expect(page.locator("[data-statistics-error]")).toHaveCount(0)
  })

  test("shows future-stage explanations and a rate-limit timer", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken("analyst")}` })
    await page.route("**/api/graphql", async (route) => {
      const body = route.request().postDataJSON() as { query?: string }
      if (body.query?.includes("GetStatisticsGrowth")) {
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ data: { statisticsGrowth: growth } })
        })
      }
      if (body.query?.includes("ExportStatistics")) {
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            errors: [{ message: "Too many requests", extensions: { code: "RATE_LIMITED", retryAfter: 1_800 } }]
          })
        })
      }
      return route.continue()
    })

    await page.goto("/admin/statistics?tab=growth&period=30d")
    await page.getByRole("button", { name: "Экспорт CSV" }).click()
    await expect(page.locator("[data-statistics-rate-limit]")).toContainText("30")

    for (const tab of ["Вовлечённость", "Финансы", "Рейтинг"]) {
      await page.getByRole("button", { name: tab }).click()
      await expect(page.locator("[data-statistics-placeholder]")).toBeVisible()
    }
  })

  test("returns 403 to a moderator", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken("moderator")}` })

    const response = await page.goto("/admin/statistics")

    expect(response?.status()).toBe(403)
  })
})
