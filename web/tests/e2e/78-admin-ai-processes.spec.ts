import { expect, test, type Page } from "./helpers/test"
import { PrismaClient, type AiProcessStatus, type Role } from "../../../server/src/generated/prisma/index.js"
import { createSessionId, signAccessToken } from "./helpers/session-token"

/** T-078: read-only AI history, moderator scope, all five states and aggregate-only cost. */
const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const prisma = new PrismaClient({ datasourceUrl: databaseUrl })

const staffRoles = ["editor", "moderator", "analyst", "admin"] as const
type StaffRole = (typeof staffRoles)[number]
const staffIds = Object.fromEntries(staffRoles.map((role) => [role, `t078-${role}`])) as Record<StaffRole, string>
const sessions = Object.fromEntries(staffRoles.map((role) => [role, ""])) as Record<StaffRole, string>

const AUTHOR_ID = "t078-author"
const REVIEW_SLUG = "t078-review"
const PUBLISHED_SLUG = "t078-published"
const statuses: AiProcessStatus[] = ["created", "started", "running", "completed", "failed"]
const processIds = statuses.map((status) => `t078-process-${status}`)
const COST_ID = "t078-cost"

async function upsertUser(id: string, role: Role, service = true) {
  const handle = id
  await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
  await prisma.user.upsert({
    where: { id },
    update: { archivedAt: null, role, isServiceAccount: service },
    create: { id, email: `${id}@example.test`, handle, name: `T078 ${role}`, role, isServiceAccount: service }
  })
  await prisma.handleHistory.update({ where: { handle }, data: { userId: id } })
}

async function createArticle(slug: string, status: "review" | "published") {
  await prisma.article.deleteMany({ where: { slug } })
  return prisma.article.create({
    data: {
      title: `T078 ${status}`,
      slug,
      body: "T078 body",
      status,
      authorId: AUTHOR_ID
    },
    select: { id: true, translations: { select: { id: true } } }
  })
}

const authorize = (page: Page, role: StaffRole) =>
  page.setExtraHTTPHeaders({ authorization: `Bearer ${signAccessToken(staffIds[role], sessions[role])}` })

test.describe("AI processes", () => {
  test.describe.configure({ mode: "serial" })

  let reviewArticleId = ""
  let publishedArticleId = ""

  test.beforeAll(async () => {
    for (const role of staffRoles) {
      await upsertUser(staffIds[role], role)
      sessions[role] = await createSessionId(prisma, staffIds[role])
    }
    await upsertUser(AUTHOR_ID, "author", false)

    const review = await createArticle(REVIEW_SLUG, "review")
    const published = await createArticle(PUBLISHED_SLUG, "published")
    reviewArticleId = review.id
    publishedArticleId = published.id
    const reviewTranslationId = review.translations[0]!.id
    const publishedTranslationId = published.translations[0]!.id

    await prisma.aiProcess.deleteMany({ where: { id: { in: processIds } } })
    await prisma.aiProcess.createMany({
      data: statuses.map((status, index) => ({
        id: processIds[index]!,
        kind: index === 4 ? "translate" : "check",
        status,
        objectType: "ArticleTranslation",
        objectId: index === 4 ? publishedTranslationId : reviewTranslationId,
        revisionId: `t078-revision-${index}`,
        verdict: status === "completed" ? "pass" : status === "failed" ? "reject" : null,
        reasons: status === "failed" ? [{ category: "provider", text: "Timeout" }] : [],
        providerErrorClass: status === "failed" ? "PROVIDER_UNAVAILABLE" : null,
        model: "t078-model",
        promptVersion: "t078-v1",
        startedAt: status === "created" ? null : new Date(Date.now() - 2_000),
        finishedAt: ["completed", "failed"].includes(status) ? new Date() : null,
        durationMs: ["completed", "failed"].includes(status) ? 2_000 : null,
        createdAt: new Date(Date.now() - index * 1_000)
      }))
    })

    const bucketEnd = new Date()
    const bucketStart = new Date(bucketEnd.getTime() - 60 * 60 * 1000)
    await prisma.aiCostAggregate.deleteMany({ where: { id: COST_ID } })
    await prisma.aiCostAggregate.create({
      data: {
        id: COST_ID,
        bucketStart,
        bucketEnd,
        kind: "check",
        totalCostMinor: 1842n,
        processCount: 5
      }
    })
  })

  test.afterAll(async () => {
    await prisma.aiProcess.deleteMany({ where: { id: { in: processIds } } })
    await prisma.aiCostAggregate.deleteMany({ where: { id: COST_ID } })
    await prisma.article.deleteMany({ where: { id: { in: [reviewArticleId, publishedArticleId].filter(Boolean) } } })
    await prisma.$disconnect()
  })

  test("analyst sees all process states, but no launch or retry", async ({ page }) => {
    await authorize(page, "analyst")
    await page.goto("/admin/ai?period=7d")

    for (const [index, status] of statuses.entries()) {
      await expect(page.locator(`[data-ai-row="${processIds[index]}"][data-ai-status="${status}"]`)).toBeVisible()
    }
    await expect(page.locator("[data-ai-readonly-note]")).toBeVisible()
    await expect(page.locator("[data-ai-action]")).toHaveCount(0)
  })

  test("cost is visible only as a period aggregate", async ({ page }) => {
    await authorize(page, "analyst")
    await page.goto("/admin/ai?tab=stats&period=7d")

    await expect(page.locator("[data-ai-total-cost]")).toContainText("1842")
    await expect(page.locator("[data-ai-row-cost]")).toHaveCount(0)

    await page.goto(`/admin/ai/${processIds[3]}`)
    await expect(page.locator(`[data-ai-card="${processIds[3]}"]`)).toBeVisible()
    await expect(page.locator("[data-ai-card-cost]")).toHaveCount(0)
    await expect(page.locator("body")).not.toContainText("1842")
  })

  test("moderator sees only the review zone and no cost statistics", async ({ page }) => {
    await authorize(page, "moderator")
    await page.goto("/admin/ai?period=7d")

    for (const id of processIds.slice(0, 4)) await expect(page.locator(`[data-ai-row="${id}"]`)).toBeVisible()
    await expect(page.locator(`[data-ai-row="${processIds[4]}"]`)).toHaveCount(0)
    await expect(page.locator('[data-ai-tab="stats"]')).toHaveCount(0)
    await expect(page.locator("[data-ai-total-cost]")).toHaveCount(0)
  })

  test("empty and error rows are reproducible", async ({ page }) => {
    await authorize(page, "admin")
    await page.goto("/admin/ai?q=t078-no-such-object")
    await expect(page.locator('[data-ai-state="empty"]')).toBeVisible()

    await page.goto("/admin/ai?q=aa")
    await expect(page.locator('[data-ai-state="error"]')).toBeVisible()
  })

  test("editor cannot open the section", async ({ page }) => {
    await authorize(page, "editor")
    const response = await page.goto("/admin/ai")
    expect(response?.status()).toBe(403)
    await expect(page.locator("[data-ai-table]")).toHaveCount(0)
  })
})
