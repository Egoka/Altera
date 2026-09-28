import { expect, test, type Page } from "./helpers/test"
import { PrismaClient, type Role } from "../../../server/src/generated/prisma/index.js"
import { createSessionId, signAccessToken } from "./helpers/session-token"
import { SESSION_ACCESS_COOKIE } from "../../shared/session"

/**
 * T-119: раздел админки «Обращения» (`00-registries/admin-sections.md` #23, журнал §37 п. 13) и
 * статус обращения в кабинете (журнал §37 п. 2).
 *
 * Критерий №1 — сотрудник видит очередь: `admin` и `owner` открывают раздел, прочие служебные
 * роли получают 403. Критерий №2 — владелец аккаунта видит статус своего обращения в кабинете.
 * Запись о чтении персональных данных при открытии карточки проверяется в базе (журнал §28.7).
 */

const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const prisma = new PrismaClient({ datasourceUrl: databaseUrl })

const roles = ["editor", "moderator", "analyst", "admin", "owner", "reader"] as const
type TestRole = (typeof roles)[number]

const userIds = Object.fromEntries(roles.map((role) => [role, `t119-${role}`])) as Record<TestRole, string>
const sessionIds = Object.fromEntries(roles.map((role) => [role, ""])) as Record<TestRole, string>

const SENDER_EMAIL = "t119-reader@example.test"
const MESSAGE = "Здравствуйте, страница материала показала ошибку после оплаты."

const requestIds = { open: "", answered: "", pending: "" }
const ticketNumbers = { answered: 0, pending: 0 }

async function upsertUser(role: TestRole) {
  const id = userIds[role]
  const handle = `t119-${role}`
  const isService = role !== "reader"
  await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
  await prisma.user.upsert({
    where: { email: role === "reader" ? SENDER_EMAIL : `${handle}@example.test` },
    update: { archivedAt: null, isServiceAccount: isService, role: role as Role },
    create: {
      id,
      email: role === "reader" ? SENDER_EMAIL : `${handle}@example.test`,
      handle,
      isServiceAccount: isService,
      name: `T119 ${role}`,
      role: role as Role
    }
  })
  await prisma.handleHistory.update({ where: { handle }, data: { userId: id } })
  sessionIds[role] = await createSessionId(prisma, id)
}

/**
 * Тема `copyright` в очереди — только у этих фикстур: остальные браузерные сценарии пишут
 * обращения других тем, поэтому фильтр раздела оставляет в списке ровно две строки.
 */
async function seedRequests() {
  const open = await prisma.supportRequest.create({
    data: {
      topic: "copyright",
      email: SENDER_EMAIL,
      message: MESSAGE,
      path: "/nauka/t119",
      requestId: "t119-request-id",
      userId: userIds.reader,
      locale: "ru",
      createdByRequestId: "t119-seed"
    },
    select: { id: true, ticketNo: true }
  })
  const answered = await prisma.supportRequest.create({
    data: {
      topic: "copyright",
      email: SENDER_EMAIL,
      message: "Первое обращение, на него уже ответили письмом.",
      userId: userIds.reader,
      locale: "ru",
      createdByRequestId: "t119-seed",
      answeredAt: new Date("2026-09-27T09:00:00.000Z"),
      answeredById: userIds.admin
    },
    select: { id: true, ticketNo: true }
  })

  // Обращение кабинета остаётся без ответа: строку «Принято» иначе стёр бы сценарий ответа.
  const pending = await prisma.supportRequest.create({
    data: {
      topic: "other",
      email: SENDER_EMAIL,
      message: "Третье обращение, ответа ещё нет.",
      userId: userIds.reader,
      locale: "ru",
      createdByRequestId: "t119-seed"
    },
    select: { id: true, ticketNo: true }
  })

  requestIds.open = open.id
  requestIds.answered = answered.id
  requestIds.pending = pending.id
  ticketNumbers.answered = answered.ticketNo
  ticketNumbers.pending = pending.ticketNo
}

const authorizeStaff = (page: Page, role: TestRole) =>
  page.setExtraHTTPHeaders({ authorization: `Bearer ${signAccessToken(userIds[role], sessionIds[role])}` })

const useAccountSession = (page: Page, role: TestRole) =>
  page.context().addCookies([
    {
      name: SESSION_ACCESS_COOKIE,
      value: signAccessToken(userIds[role], sessionIds[role]),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }
  ])

test.describe("очередь обращений и статус в кабинете", () => {
  test.describe.configure({ mode: "serial" })

  test.beforeAll(async () => {
    for (const role of roles) await upsertUser(role)
    await seedRequests()
  })

  test.afterAll(async () => {
    await prisma.supportRequest.deleteMany({
      where: { id: { in: [requestIds.open, requestIds.answered, requestIds.pending] } }
    })
    await prisma.$disconnect()
  })

  test("admin видит очередь с маской адреса и без текста обращения", async ({ page }) => {
    await authorizeStaff(page, "admin")

    await page.goto("/admin/support?topic=copyright")

    const row = page.locator(`[data-support-row="${requestIds.open}"]`)
    await expect(row).toHaveAttribute("data-support-status", "received")
    await expect(row.locator("[data-support-email]")).toHaveText("t***r@example.test")
    await expect(page.locator("[data-support-table]")).not.toContainText(MESSAGE)
    await expect(page.locator("[data-support-masked-note]")).toBeVisible()
    await expect(page.locator(`[data-support-row="${requestIds.answered}"]`)).toHaveAttribute(
      "data-support-status",
      "answered"
    )
    await expect(page.locator("[data-support-open-count]")).toContainText("Без ответа")
  })

  test("фильтр статуса оставляет в очереди только неотвеченные", async ({ page }) => {
    await authorizeStaff(page, "owner")

    await page.goto("/admin/support?topic=copyright&status=received")

    await expect(page.locator(`[data-support-row="${requestIds.open}"]`)).toBeVisible()
    await expect(page.locator(`[data-support-row="${requestIds.answered}"]`)).toHaveCount(0)
  })

  test("прочие служебные роли раздел не открывают", async ({ page }) => {
    for (const role of ["editor", "moderator", "analyst"] as const) {
      await authorizeStaff(page, role)

      const response = await page.goto("/admin/support")

      expect(response?.status()).toBe(403)
      await expect(page.locator("[data-support-table]")).toHaveCount(0)
    }
  })

  test("карточка показывает адрес и текст, ответ переводит обращение в «Отвечено»", async ({ page }) => {
    await authorizeStaff(page, "owner")

    await page.goto(`/admin/support/${requestIds.open}`)

    await expect(page.locator("[data-support-card-email]")).toHaveText(SENDER_EMAIL)
    await expect(page.locator("[data-support-card-message]")).toContainText(MESSAGE)
    await expect(page.locator("[data-support-card-status]")).toHaveText("Принято")

    // Открытие карточки — чтение персональных данных (журнал §28.7).
    const audit = await prisma.auditLog.findFirst({
      where: { action: "admin.read.personal", entityType: "supportRequest", entityId: requestIds.open },
      orderBy: { createdAt: "desc" }
    })
    expect(audit).toMatchObject({ context: "support", purpose: "admin.support.read", actorRole: "owner" })

    await page.locator("[data-support-card-answer]").click()

    await expect(page.locator("[data-support-card-status]")).toHaveText("Отвечено")
    await expect(page.locator("[data-support-card-answer]")).toHaveCount(0)

    const saved = await prisma.supportRequest.findUnique({ where: { id: requestIds.open } })
    expect(saved?.answeredById).toBe(userIds.owner)
    expect(saved?.answeredAt).toBeInstanceOf(Date)
  })

  test("владелец аккаунта видит статус своих обращений в кабинете", async ({ page }) => {
    await useAccountSession(page, "reader")

    await page.goto("/me")

    const zone = page.getByTestId("dashboard-support")
    await expect(zone).toBeVisible()
    await expect(zone.locator(`[data-support-request="${ticketNumbers.pending}"]`)).toHaveAttribute(
      "data-support-status",
      "received"
    )
    await expect(zone.locator(`[data-support-request="${ticketNumbers.answered}"]`)).toHaveAttribute(
      "data-support-status",
      "answered"
    )
    await expect(zone).toContainText("Принято")
    await expect(zone).toContainText("Отвечено")
    // Ни адреса, ни текста обращения в кабинете нет: отправитель видит номер, тему и статус.
    await expect(zone).not.toContainText(MESSAGE)
  })
})
