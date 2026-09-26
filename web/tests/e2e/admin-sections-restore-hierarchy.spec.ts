import { expect, test } from "./helpers/test"
import { PrismaClient } from "../../../server/src/generated/prisma/index.js"
import { createSessionId, signAccessToken } from "./helpers/session-token"

/**
 * T-132: строки состояний раздела «Категории» (`40-admin/categories.md` §9).
 * «Нет прав на часть действий» — `admin` в карточке рубрики, заархивированной `owner`.
 * «Конфликт» — сохранение поверх версии, изменённой другим сотрудником.
 */
const databaseUrl =
  process.env.T069_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
let adminSessionId = ""

const token = () => signAccessToken("t132-admin", adminSessionId)

const seedSection = async (id: string, name: string, order: number) => {
  await prisma.sectionSlugHistory.upsert({ where: { slug: id }, create: { slug: id }, update: {} })
  await prisma.section.upsert({
    where: { slug: id },
    update: { status: "active", successorId: null, archivedByRole: null, archivedByActorId: null, order },
    create: { id, name, nameEn: name, slug: id, order }
  })
  await prisma.sectionSlugHistory.update({
    where: { slug: id },
    data: { ownerSectionId: id, redirectToSectionId: null }
  })
}

test.describe("admin sections restore hierarchy", () => {
  test.describe.configure({ mode: "serial" })

  test.beforeAll(async () => {
    await prisma.handleHistory.upsert({ where: { handle: "t132-admin" }, update: {}, create: { handle: "t132-admin" } })
    await prisma.user.upsert({
      where: { email: "t132-admin@example.test" },
      update: { archivedAt: null, isServiceAccount: true, role: "admin" },
      create: {
        id: "t132-admin",
        email: "t132-admin@example.test",
        handle: "t132-admin",
        isServiceAccount: true,
        name: "T132 admin",
        role: "admin"
      }
    })
    await prisma.handleHistory.update({ where: { handle: "t132-admin" }, data: { userId: "t132-admin" } })
    adminSessionId = await createSessionId(prisma, "t132-admin")

    await seedSection("t132-live", "T132 Живая", 1320)
    await seedSection("t132-owner-archive", "T132 Архив владельца", 1321)
    await seedSection("t132-admin-archive", "T132 Архив админа", 1322)

    // Рубрику архивирует владелец: роль ниже её не восстанавливает (журнал #2).
    await prisma.section.update({
      where: { id: "t132-owner-archive" },
      data: {
        status: "archived",
        successorId: "t132-live",
        archivedAt: new Date(),
        archivedByRole: "owner",
        archivedByActorId: "t132-admin"
      }
    })
    await prisma.section.update({
      where: { id: "t132-admin-archive" },
      data: {
        status: "archived",
        successorId: "t132-live",
        archivedAt: new Date(),
        archivedByRole: "admin",
        archivedByActorId: "t132-admin"
      }
    })
  })

  test.afterAll(async () => prisma.$disconnect())

  test("hides restore from an admin for a section the owner archived", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${token()}` })
    const response = await page.goto("/admin/sections?status=archived")

    expect(response?.status()).toBe(200)
    await expect(page.locator('[data-no-restore-section="t132-owner-archive"]')).toContainText(/владельцем/i)
    await expect(page.locator('[data-restore-section="t132-owner-archive"]')).toHaveCount(0)
    // Свой архив `admin` восстанавливает: строка состояния касается только архива владельца.
    await expect(page.locator('[data-restore-section="t132-admin-archive"]')).toBeVisible()

    await page.locator('[data-restore-section="t132-admin-archive"]').click()
    await expect
      .poll(() => prisma.section.findUnique({ where: { id: "t132-admin-archive" } }).then((row) => row?.status))
      .toBe("active")
    // Архив владельца остался архивом, и отказ не оставил записи в журнале.
    await expect
      .poll(() => prisma.section.findUnique({ where: { id: "t132-owner-archive" } }).then((row) => row?.status))
      .toBe("archived")
    expect(await prisma.auditLog.count({ where: { action: "section.restore", entityId: "t132-owner-archive" } })).toBe(
      0
    )
  })

  test("explains a conflict when another administrator already changed the section", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${token()}` })
    await page.goto("/admin/sections?status=active")

    await expect(page.locator('[data-taxonomy-row="t132-live"]')).toBeVisible()
    await page.locator('[data-edit-section="t132-live"]').click()

    // Другой сотрудник сохранил рубрику, пока карточка была открыта: версия карточки устарела.
    await prisma.section.update({ where: { id: "t132-live" }, data: { name: "T132 Живая (другой админ)" } })

    await page.locator("[data-taxonomy-editor] input[required]").first().fill("T132 Живая (моя правка)")
    await page.locator('[data-taxonomy-editor] button[type="submit"]').click()

    await expect(page.locator("[data-taxonomy-conflict]")).toContainText(/обновите карточку/i)
    // Форма осталась на экране с введённым текстом, а чужая правка не перезаписана.
    await expect(page.locator("[data-taxonomy-editor] input[required]").first()).toHaveValue("T132 Живая (моя правка)")
    expect(await prisma.section.findUnique({ where: { id: "t132-live" } }).then((row) => row?.name)).toBe(
      "T132 Живая (другой админ)"
    )
  })
})
