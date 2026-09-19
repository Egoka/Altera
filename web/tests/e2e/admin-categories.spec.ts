import { expect, test } from "@playwright/test"
import { createHmac } from "node:crypto"
import { PrismaClient } from "../../../server/src/generated/prisma/index.js"

const databaseUrl =
  process.env.T070_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
const accessSecret = "t009-test-access-secret"

const token = () => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900, role: "admin", userId: "t070-admin" })
  ).toString("base64url")
  const unsigned = `${header}.${payload}`
  return `${unsigned}.${createHmac("sha256", accessSecret).update(unsigned).digest("base64url")}`
}

test.describe("admin categories", () => {
  test.describe.configure({ mode: "serial" })

  test.beforeAll(async () => {
    await prisma.handleHistory.upsert({ where: { handle: "t070-admin" }, update: {}, create: { handle: "t070-admin" } })
    await prisma.handleHistory.upsert({
      where: { handle: "t070-author" },
      update: {},
      create: { handle: "t070-author" }
    })
    await prisma.user.upsert({
      where: { email: "t070-admin@example.test" },
      update: { archivedAt: null, isServiceAccount: true, role: "admin" },
      create: {
        id: "t070-admin",
        email: "t070-admin@example.test",
        handle: "t070-admin",
        isServiceAccount: true,
        name: "T070 admin",
        role: "admin"
      }
    })
    await prisma.user.upsert({
      where: { email: "t070-author@example.test" },
      update: { archivedAt: null, role: "author" },
      create: {
        id: "t070-author",
        email: "t070-author@example.test",
        handle: "t070-author",
        name: "T070 author",
        role: "author"
      }
    })
    await prisma.handleHistory.update({ where: { handle: "t070-admin" }, data: { userId: "t070-admin" } })
    await prisma.handleHistory.update({ where: { handle: "t070-author" }, data: { userId: "t070-author" } })
    await prisma.section.upsert({
      where: { slug: "t070-culture" },
      update: { status: "active", successorId: null, order: 700 },
      create: { id: "t070-culture", name: "T070 Культура", nameEn: "T070 Culture", slug: "t070-culture", order: 700 }
    })
    await prisma.section.upsert({
      where: { slug: "t070-science" },
      update: { status: "active", successorId: null, order: 701 },
      create: { id: "t070-science", name: "T070 Наука", nameEn: "T070 Science", slug: "t070-science", order: 701 }
    })
    await prisma.format.upsert({
      where: { slug: "t070-essay" },
      update: { status: "active" },
      create: { id: "t070-essay", name: "T070 Эссе", nameEn: "T070 Essay", slug: "t070-essay" }
    })
    await prisma.article.upsert({
      where: { slug: "t070-material" },
      update: { sectionId: "t070-culture", formatId: "t070-essay" },
      create: {
        id: "t070-material",
        authorId: "t070-author",
        body: "Fixture",
        slug: "t070-material",
        title: "T070 material",
        sectionId: "t070-culture",
        formatId: "t070-essay"
      }
    })
  })

  test.afterAll(async () => prisma.$disconnect())

  test("archives a section only after an active successor is selected", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${token()}` })
    const response = await page.goto("/admin/sections?status=all")

    expect(response?.status()).toBe(200)
    await expect(page.locator('[data-taxonomy-row="t070-culture"]')).toBeVisible()
    await page.locator('[data-archive-section="t070-culture"]').click()
    await expect(page.locator("[data-confirm-archive-section]")).toBeDisabled()
    await page.locator("[data-successor-select]").selectOption("t070-science")
    await page.locator("[data-archive-reason]").fill("T070 consolidation")
    await page.locator("[data-confirm-archive-section]").click()

    await expect(page.locator('[data-taxonomy-row="t070-culture"]')).toContainText(/восстановить/i)
    await expect
      .poll(() => prisma.article.findUnique({ where: { id: "t070-material" } }).then((item) => item?.sectionId))
      .toBe("t070-science")
    await expect
      .poll(() => prisma.auditLog.count({ where: { action: "section.archive", entityId: "t070-culture" } }))
      .toBeGreaterThan(0)

    const redirect = await page.request.get("/t070-culture", { maxRedirects: 0 })
    expect(redirect.status()).toBe(301)
    expect(redirect.headers().location).toBe("/t070-science")
  })

  test("shows formats and their material counts", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${token()}` })
    await page.goto("/admin/sections?tab=formats&status=all")

    await page.locator('[data-taxonomy-tab="formats"]').click()
    await expect(page.locator('[data-taxonomy-row="t070-essay"]')).toContainText("1")
  })
})
