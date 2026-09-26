import { expect, test } from "./helpers/test"
import { PrismaClient, type Role } from "../../../server/src/generated/prisma/index.js"
import { createSessionId, signAccessToken } from "./helpers/session-token"

const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
const serviceRoles = ["editor", "moderator", "analyst", "admin", "owner"] as const satisfies readonly Role[]
const userIds = Object.fromEntries([...serviceRoles, "author"].map((role) => [role, `t069-${role}`])) as Record<
  (typeof serviceRoles)[number] | "author",
  string
>

const sessionIds = {} as Record<(typeof serviceRoles)[number] | "author", string>

const signToken = (role: (typeof serviceRoles)[number] | "author") => signAccessToken(userIds[role], sessionIds[role])

async function upsertUser(role: (typeof serviceRoles)[number] | "author") {
  const id = userIds[role]
  const handle = `t069-${role}`
  await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
  await prisma.user.upsert({
    where: { email: `${handle}@example.test` },
    update: { archivedAt: null, isServiceAccount: role !== "author", role },
    create: {
      id,
      email: `${handle}@example.test`,
      handle,
      isServiceAccount: role !== "author",
      name: `T069 ${role}`,
      role,
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    }
  })
  await prisma.handleHistory.update({ where: { handle }, data: { userId: id } })
  sessionIds[role] = await createSessionId(prisma, id)
}

async function seedWorkingData() {
  const article = await prisma.article.upsert({
    where: { slug: "t069-editorial-review" },
    update: { isEditorial: true, status: "review" },
    create: {
      id: "t069-article",
      authorId: userIds.author,
      body: "T069 fixture",
      isEditorial: true,
      slug: "t069-editorial-review",
      status: "review",
      title: "T069 editorial review"
    }
  })
  const translation = await prisma.articleTranslation.upsert({
    where: { articleId_locale: { articleId: article.id, locale: "en" } },
    update: { status: "review" },
    create: {
      id: "t069-translation",
      articleId: article.id,
      body: { type: "root", children: [] },
      locale: "en",
      slug: "t069-editorial-review-en",
      status: "review",
      title: "T069 editorial review"
    }
  })

  await Promise.all([
    prisma.reviewMessage.upsert({
      where: { id: "t069-review-message" },
      update: { readAt: null },
      create: {
        id: "t069-review-message",
        byRole: "moderator",
        kind: "message",
        text: "T069 fixture",
        translationId: translation.id
      }
    }),
    prisma.aiProcess.upsert({
      where: { id: "t069-ai-process" },
      update: { status: "running" },
      create: {
        id: "t069-ai-process",
        kind: "check",
        objectId: article.id,
        objectType: "Article",
        status: "running"
      }
    }),
    prisma.mailMessage.upsert({
      where: { id: "t069-mail" },
      update: { status: "failed" },
      create: {
        id: "t069-mail",
        objectId: article.id,
        objectType: "Article",
        recipientEmail: "recipient@example.test",
        sanitizedBody: "Fixture",
        status: "failed",
        subject: "Fixture",
        template: "t069"
      }
    }),
    prisma.job.upsert({
      where: { id: "t069-job" },
      update: { status: "failed" },
      create: { id: "t069-job", kind: "t069", status: "failed" }
    }),
    prisma.backendError.upsert({
      where: { signature: "t069-error" },
      update: { workStatus: "new_record" },
      create: {
        id: "t069-error",
        code: "T069",
        sanitizedMessage: "Fixture failure",
        service: "web",
        signature: "t069-error",
        workStatus: "new_record"
      }
    }),
    prisma.planGrant.upsert({
      where: { id: "t069-plan" },
      update: { revokedAt: null },
      create: {
        id: "t069-plan",
        reason: "T069 fixture",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        tier: "standard",
        userId: userIds.author
      }
    })
  ])
}

test.describe("admin dashboard", () => {
  test.describe.configure({ mode: "serial" })

  test.beforeAll(async () => {
    for (const role of [...serviceRoles, "author"] as const) await upsertUser(role)
  })

  test.afterAll(async () => {
    await prisma.$disconnect()
  })

  test("shows the empty state when the editor has no working data", async ({ page }) => {
    const token = signToken("editor")
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${token}` })
    await page.route("**/api/graphql", async (route) => {
      const body = route.request().postDataJSON() as { query?: string }
      if (!body.query?.includes("GetAdminSummary")) return route.continue()
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: { adminSummary: { role: "editor", cards: [] } } })
      })
    })

    const response = await page.goto("/admin")

    expect(response?.status()).toBe(200)
    await page.getByRole("button", { name: "Обновить" }).click()
    await expect(page.getByText("Данных пока нет")).toBeVisible()
    await seedWorkingData()
  })

  for (const [role, visibleCard, hiddenCard] of [
    ["editor", "editorial", "health"],
    ["moderator", "reviewQueue", "growth"],
    ["analyst", "growth", "health"],
    ["admin", "health", "ownership"],
    ["owner", "ownership", null]
  ] as const) {
    test(`${role} sees only its working dashboard cards`, async ({ page }) => {
      const token = signToken(role)
      await page.setExtraHTTPHeaders({ authorization: `Bearer ${token}` })

      const response = await page.goto("/admin")

      expect(response?.status()).toBe(200)
      await expect(page.locator(`[data-admin-card="${visibleCard}"]`)).toBeVisible()
      if (hiddenCard) await expect(page.locator(`[data-admin-card="${hiddenCard}"]`)).toHaveCount(0)
    })
  }

  test("author receives HTTP 403 for /admin", async ({ page }) => {
    const token = signToken("author")
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${token}` })

    const response = await page.goto("/admin")

    expect(response?.status()).toBe(403)
    await expect(page.locator("[data-admin-card]")).toHaveCount(0)
  })

  test("guest is redirected to login with the original admin target", async ({ page }) => {
    await page.goto("/admin?period=30d")

    await expect(page).toHaveURL(
      (url) => url.pathname === "/login" && url.searchParams.get("next") === "/admin?period=30d"
    )
  })

  test("refresh exposes loading and keeps ready cards beside a failed card", async ({ page }) => {
    const token = signToken("admin")
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${token}` })
    await page.goto("/admin")
    await page.waitForLoadState("networkidle")
    let releaseResponse = () => {}
    let markRequestStarted = () => {}
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve
    })
    await page.route("**/api/graphql", async (route) => {
      const body = route.request().postDataJSON() as { query?: string }
      if (!body.query?.includes("GetAdminSummary")) return route.continue()
      markRequestStarted()
      await responseGate
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            adminSummary: {
              role: "admin",
              cards: [
                {
                  id: "growth",
                  href: "/admin/statistics",
                  status: "READY",
                  requestId: null,
                  metrics: [{ id: "registrations", value: 3 }]
                },
                {
                  id: "health",
                  href: "/admin/errors",
                  status: "ERROR",
                  requestId: "req-partial",
                  metrics: []
                }
              ]
            }
          }
        })
      })
    })

    const refreshClick = page.getByRole("button", { name: "Обновить" }).click()
    await requestStarted
    await expect(page.locator('[aria-busy="true"]')).toBeAttached()
    releaseResponse()
    await refreshClick
    await expect(page.locator('[data-admin-card="growth"]')).toContainText("3")
    await expect(page.locator('[data-admin-card="health"]')).toContainText("req-partial")
  })

  test("refresh shows the safe requestId for a whole-query failure", async ({ page }) => {
    const token = signToken("admin")
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${token}` })
    await page.goto("/admin")
    await page.waitForLoadState("networkidle")
    await page.route("**/api/graphql", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          errors: [{ message: "Internal server error", extensions: { code: "INTERNAL_ERROR", requestId: "req-whole" } }]
        })
      })
    )

    await page.getByRole("button", { name: "Обновить" }).click()

    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toBeVisible()
    await expect(page.getByText("requestId: req-whole")).toBeVisible()
  })
})
