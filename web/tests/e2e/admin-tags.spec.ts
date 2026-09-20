import { expect, test } from "@playwright/test"
import { PrismaClient } from "../../../server/src/generated/prisma/index.js"
import { createSessionId, signAccessToken } from "./helpers/session-token"

const databaseUrl =
  process.env.T071_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
let sessionId = ""

// Слияние проверяет идентификаторы источников как UUID (`validateBulkOperation`),
// поэтому фикстуры тегов используют фиксированные UUID, а не читаемые строки.
const TARGET = "0de0f52a-7071-4a71-9c21-000000000001"
const SOURCE = "0de0f52a-7071-4a71-9c21-000000000002"
const SHELF = "0de0f52a-7071-4a71-9c21-000000000003"
const OWNER_ARCHIVED = "0de0f52a-7071-4a71-9c21-000000000004"

const token = () => signAccessToken("t071-admin", sessionId)

const seedTag = async (
  id: string,
  slug: string,
  name: string,
  state: { status: "active" | "archived"; archivedByRole?: "admin" | "owner" } = { status: "active" }
) => {
  await prisma.tagSlugHistory.upsert({ where: { slug }, create: { slug }, update: {} })
  await prisma.tag.upsert({
    where: { id },
    update: {
      status: state.status,
      mergedIntoId: null,
      archivedAt: state.status === "archived" ? new Date() : null,
      archivedByRole: state.archivedByRole ?? null,
      archivedByActorId: state.archivedByRole ? "t071-admin" : null
    },
    create: {
      id,
      name,
      slug,
      status: state.status,
      archivedAt: state.status === "archived" ? new Date() : null,
      archivedByRole: state.archivedByRole ?? null,
      archivedByActorId: state.archivedByRole ? "t071-admin" : null
    }
  })
  await prisma.tagSlugHistory.update({
    where: { slug },
    data: { ownerTagId: id, redirectToTagId: state.status === "active" ? id : null }
  })
}

test.describe("admin tags", () => {
  test.describe.configure({ mode: "serial" })

  test.beforeAll(async () => {
    for (const handle of ["t071-admin", "t071-author"]) {
      await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
    }
    await prisma.user.upsert({
      where: { email: "t071-admin@example.test" },
      update: { archivedAt: null, isServiceAccount: true, role: "admin" },
      create: {
        id: "t071-admin",
        email: "t071-admin@example.test",
        handle: "t071-admin",
        isServiceAccount: true,
        name: "T071 admin",
        role: "admin"
      }
    })
    await prisma.user.upsert({
      where: { email: "t071-author@example.test" },
      update: { archivedAt: null, role: "author" },
      create: {
        id: "t071-author",
        email: "t071-author@example.test",
        handle: "t071-author",
        name: "T071 author",
        role: "author"
      }
    })
    await prisma.handleHistory.update({ where: { handle: "t071-admin" }, data: { userId: "t071-admin" } })
    await prisma.handleHistory.update({ where: { handle: "t071-author" }, data: { userId: "t071-author" } })
    sessionId = await createSessionId(prisma, "t071-admin")

    await prisma.auditLog.deleteMany({ where: { entityType: "Tag", entityId: { in: [SOURCE, SHELF] } } })
    await seedTag(TARGET, "t071-cinema", "T071 Кино")
    await seedTag(SOURCE, "t071-kino", "T071 Кинематограф")
    await seedTag(SHELF, "t071-shelf", "T071 Полка")
    await seedTag(OWNER_ARCHIVED, "t071-owner-archive", "T071 Архив владельца", {
      status: "archived",
      archivedByRole: "owner"
    })

    await prisma.article.upsert({
      where: { slug: "t071-material" },
      update: { tags: { set: [{ id: SOURCE }] } },
      create: {
        id: "t071-material",
        authorId: "t071-author",
        body: "Fixture",
        slug: "t071-material",
        title: "T071 material",
        tags: { connect: [{ id: SOURCE }] }
      }
    })
  })

  test.afterAll(async () => prisma.$disconnect())

  test("merges a tag, moves its articles and answers 301 on the source slug", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${token()}` })
    const response = await page.goto("/admin/tags?status=all")

    expect(response?.status()).toBe(200)
    await expect(page.locator('[data-tag-row="t071-kino"]')).toBeVisible()

    await page.locator('[data-tag-select="t071-kino"]').check()
    await page.locator("[data-merge-open]").click()
    await expect(page.locator("[data-merge-total]")).toContainText("1")
    await expect(page.locator("[data-confirm-merge]")).toBeDisabled()
    await page.locator("[data-merge-target]").selectOption(TARGET)
    await page.locator("[data-confirm-merge]").click()

    await expect(page.locator('[data-tag-merged="t071-kino"]')).toBeVisible()
    await expect(page.locator('[data-no-restore="t071-kino"]')).toBeVisible()
    await expect
      .poll(() =>
        prisma.article
          .findUnique({ where: { id: "t071-material" }, select: { tags: { select: { id: true } } } })
          .then((article) => article?.tags.map(({ id }) => id))
      )
      .toEqual([TARGET])
    await expect
      .poll(() => prisma.auditLog.count({ where: { action: "tag.merge", entityId: SOURCE } }))
      .toBeGreaterThan(0)

    const redirect = await page.request.get("/tags/t071-kino", { maxRedirects: 0 })
    expect(redirect.status()).toBe(301)
    expect(redirect.headers().location).toBe("/tags/t071-cinema")
  })

  test("archives and restores a tag, leaving the owner archive without a restore action", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${token()}` })
    await page.goto("/admin/tags?status=all")

    await expect(page.locator('[data-no-restore="t071-owner-archive"]')).toBeVisible()

    await page.locator('[data-archive-tag="t071-shelf"]').click()
    await expect(page.locator("[data-archive-count]")).toContainText("0")
    await page.locator("[data-confirm-archive]").click()

    await expect(page.locator('[data-restore-tag="t071-shelf"]')).toBeVisible()
    await expect
      .poll(() => prisma.auditLog.count({ where: { action: "tag.archive", entityId: SHELF } }))
      .toBeGreaterThan(0)

    await page.locator('[data-restore-tag="t071-shelf"]').click()
    await expect(page.locator('[data-archive-tag="t071-shelf"]')).toBeVisible()
    await expect
      .poll(() => prisma.auditLog.count({ where: { action: "tag.restore", entityId: SHELF } }))
      .toBeGreaterThan(0)
  })

  test("shows the empty state when the filter matches nothing", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${token()}` })
    await page.goto("/admin/tags?status=all")

    // Ввод до гидратации теряется: Vue перерисовывает поле из пустого `search`.
    // Поэтому ввод повторяется, пока фильтр не применится.
    await expect(async () => {
      await page.locator("[data-tag-search]").fill("t071-no-such-tag")
      await expect(page.locator("[data-tag-empty]")).toBeVisible({ timeout: 1000 })
    }).toPass()
  })
})
