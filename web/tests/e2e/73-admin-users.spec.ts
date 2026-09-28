import { expect, test, type Page } from "./helpers/test"
import { PrismaClient, type Role } from "../../../server/src/generated/prisma/index.js"
import { createSessionId, signAccessToken } from "./helpers/session-token"

/**
 * T-073: строки состояний раздела «Пользователи» (`docs/spec/40-admin/users.md` §9) и шаги 1–2, 5
 * flow #11 (`docs/spec/10-flows/archive-account.md`) на живой базе.
 *
 * §9 «Загрузка» — скелеты: состояние держится доли секунды и проверяется без сети в
 * `web/tests/admin-users-page.nuxt.test.ts`; здесь проверяются «Пусто», «Ошибка» с `requestId`,
 * «Нет прав на часть действий» (аналитик — карточка без кнопок) и «Конфликт» (повторная
 * блокировка и повторное восстановление), а также сам результат блокировки и восстановления.
 * Строка «Лимит» в спецификации помечена «не применимо»: административные действия не лимитируются.
 */

const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const prisma = new PrismaClient({ datasourceUrl: databaseUrl })

const staffRoles = ["editor", "moderator", "analyst", "admin", "owner"] as const
type StaffRole = (typeof staffRoles)[number]

const staffIds = Object.fromEntries(staffRoles.map((role) => [role, `t073-${role}`])) as Record<StaffRole, string>
const staffSessions = Object.fromEntries(staffRoles.map((role) => [role, ""])) as Record<StaffRole, string>

const TARGET_ID = "t073-target"
const TARGET_HANDLE = "t073-target"
const TARGET_EMAIL = "t073.target@example.test"
const RESTORE_ID = "t073-restore"
const RESTORE_HANDLE = "t073-restore"
const EMAIL_ID = "t073-email"
const EMAIL_HANDLE = "t073-email"
const EMAIL_ADDRESS = "t073.email@example.test"

const PLAN_UNTIL = new Date("2026-12-01T00:00:00.000Z")
const PLAN_REASON = "T073 оплаченный период фикстуры"

async function upsertStaff(role: StaffRole) {
  const id = staffIds[role]
  const handle = `t073-${role}`
  await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
  await prisma.user.upsert({
    // Ключ — `id`, а не адрес: сценарий смены адреса меняет почту фикстуры, и повторный прогон
    // по адресу уже не нашёл бы запись и упёрся бы в уникальный `id`.
    where: { id },
    update: { archivedAt: null, isServiceAccount: true, role: role as Role },
    create: {
      id,
      email: `${handle}@example.test`,
      handle,
      isServiceAccount: true,
      name: `T073 ${role}`,
      role: role as Role
    }
  })
  await prisma.handleHistory.update({ where: { handle }, data: { userId: id } })
  staffSessions[role] = await createSessionId(prisma, id)
}

async function upsertAccount(input: { id: string; handle: string; email: string; name: string }) {
  await prisma.handleHistory.upsert({ where: { handle: input.handle }, update: {}, create: { handle: input.handle } })
  await prisma.user.upsert({
    where: { id: input.id },
    update: {
      email: input.email,
      archivedAt: null,
      archiveMode: null,
      archivedByActorId: null,
      archivedByRole: null,
      archiveReason: null,
      archiveReasonCategory: null,
      archivePublicMessage: null,
      role: "author",
      planTier: "standard",
      planUntil: PLAN_UNTIL
    },
    create: {
      id: input.id,
      email: input.email,
      handle: input.handle,
      name: input.name,
      role: "author",
      planTier: "standard",
      planUntil: PLAN_UNTIL
    }
  })
  await prisma.handleHistory.update({ where: { handle: input.handle }, data: { userId: input.id } })
  // Состояние плана карточка выводит из выдач, а не из кэша записи (`role-derivation.md` п. 1, 9):
  // без выдачи предупреждение о плане честно сообщило бы, что оплаченного периода нет.
  await prisma.planGrant.deleteMany({ where: { userId: input.id, reason: PLAN_REASON } })
  await prisma.planGrant.create({
    data: {
      userId: input.id,
      tier: "standard",
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: PLAN_UNTIL,
      grantedById: staffIds.owner,
      reason: PLAN_REASON
    }
  })
}

/** Повторный прогон того же спека начинается с чистых материалов: `slug` уникален. */
const createArticle = async (authorId: string, slug: string, status: "published" | "draft") => {
  await prisma.article.deleteMany({ where: { slug } })
  return prisma.article.create({
    data: {
      title: `T073 ${slug}`,
      slug,
      body: "T073 тело материала",
      status,
      authorId,
      ...(status === "published"
        ? { publishedAt: new Date("2026-09-10T00:00:00.000Z"), firstPublishedAt: new Date("2026-09-10T00:00:00.000Z") }
        : {})
    },
    select: { id: true }
  })
}

const authorize = (page: Page, role: StaffRole) =>
  page.setExtraHTTPHeaders({ authorization: `Bearer ${signAccessToken(staffIds[role], staffSessions[role])}` })

test.describe("раздел «Пользователи»", () => {
  test.describe.configure({ mode: "serial" })

  const articleIds: string[] = []

  test.beforeAll(async () => {
    for (const role of staffRoles) await upsertStaff(role)
    await upsertAccount({ id: TARGET_ID, handle: TARGET_HANDLE, email: TARGET_EMAIL, name: "T073 цель блокировки" })
    await upsertAccount({
      id: RESTORE_ID,
      handle: RESTORE_HANDLE,
      email: "t073.restore@example.test",
      name: "T073 восстановление"
    })
    await upsertAccount({ id: EMAIL_ID, handle: EMAIL_HANDLE, email: EMAIL_ADDRESS, name: "T073 смена адреса" })

    articleIds.length = 0
    articleIds.push((await createArticle(TARGET_ID, "t073-published", "published")).id)
    articleIds.push((await createArticle(TARGET_ID, "t073-draft", "draft")).id)
    // Прошлый прогон мог оставить закрытые сессии: счёт отозванных берётся из двух новых.
    await prisma.session.deleteMany({ where: { userId: TARGET_ID } })
    await createSessionId(prisma, TARGET_ID)
    await createSessionId(prisma, TARGET_ID)
  })

  test.afterAll(async () => {
    await prisma.article.deleteMany({ where: { id: { in: articleIds } } })
    await prisma.$disconnect()
  })

  test("список идёт маской адреса и ведёт на карточку по идентификатору", async ({ page }) => {
    await authorize(page, "admin")

    await page.goto(`/admin/users?q=${encodeURIComponent(TARGET_EMAIL)}`)

    const row = page.locator(`[data-users-row="${TARGET_ID}"]`)
    await expect(row).toHaveAttribute("data-users-status", "active")
    await expect(row.locator("[data-users-email]")).toHaveText("t***t@example.test")
    await expect(page.locator("[data-users-table]")).not.toContainText(TARGET_EMAIL)
    await expect(page.locator("[data-users-masked-note]")).toBeVisible()

    // Поиск сверяется с адресом, поэтому он записан как чтение персональных данных (§4, §8).
    const search = await prisma.auditLog.findFirst({
      where: { action: "admin.read.personal", entityType: "user", purpose: "admin.users.search" },
      orderBy: { createdAt: "desc" }
    })
    expect(search).toMatchObject({ actorId: staffIds.admin, context: "admin.users" })
  })

  test("§9 «Пусто»: фильтр без совпадений показывает пустое состояние", async ({ page }) => {
    await authorize(page, "owner")

    await page.goto("/admin/users?q=t073-никого-нет")

    await expect(page.locator('[data-users-state="empty"]')).toBeVisible()
    await expect(page.locator("[data-users-table]")).toHaveCount(0)
  })

  test("§9 «Ошибка»: отказ запроса показывает ErrorState с повтором", async ({ page }) => {
    await authorize(page, "admin")

    // Неверная дата фильтра — `VALIDATION_ERROR` от сервера: раздел показывает `ErrorState`.
    await page.goto("/admin/users?registeredFrom=не-дата")

    const error = page.locator('[data-users-state="error"]')
    await expect(error).toBeVisible()
    await expect(page.locator("[data-users-table]")).toHaveCount(0)
    // Строку `requestId` словарь ошибок отдаёт только для `INTERNAL_ERROR` и
    // `PROVIDER_UNAVAILABLE` (`errors/graphql-error.ts`): клиентская ошибка её не несёт, поэтому
    // сама отрисовка `requestId` проверяется в `web/tests/admin-users-page.nuxt.test.ts`.
    await expect(error.getByRole("button")).toBeVisible()
  })

  test("редактор и модератор раздел не открывают", async ({ page }) => {
    for (const role of ["editor", "moderator"] as const) {
      await authorize(page, role)

      const response = await page.goto("/admin/users")

      expect(response?.status()).toBe(403)
      await expect(page.locator("[data-users-table]")).toHaveCount(0)
    }
  })

  test("карточка раскрывает адрес и пишет чтение персональных данных", async ({ page }) => {
    await authorize(page, "admin")

    await page.goto(`/admin/users/${TARGET_ID}`)

    await expect(page.locator("[data-users-card-email]")).toHaveText(TARGET_EMAIL)
    await expect(page.locator("[data-users-card-authorship]")).toBeVisible()
    await expect(page.locator(`[data-users-article="${articleIds[0]}"]`)).toBeVisible()
    await expect(page.locator("[data-users-session]").first()).toBeVisible()

    const audit = await prisma.auditLog.findFirst({
      where: { action: "admin.read.personal", entityType: "user", entityId: TARGET_ID },
      orderBy: { createdAt: "desc" }
    })
    expect(audit).toMatchObject({ context: "admin.users", purpose: "admin.user.read", actorRole: "admin" })
  })

  test("§9 «Нет прав на часть действий»: аналитик видит карточку без кнопок и без сессий", async ({ page }) => {
    await authorize(page, "analyst")

    await page.goto(`/admin/users/${TARGET_ID}`)

    await expect(page.locator("[data-users-card-email]")).toHaveText(TARGET_EMAIL)
    await expect(page.locator("[data-users-readonly-note]")).toBeVisible()
    await expect(page.locator("[data-users-open-archive]")).toHaveCount(0)
    await expect(page.locator("[data-users-open-emergency]")).toHaveCount(0)
    await expect(page.locator("[data-users-open-restore]")).toHaveCount(0)
    await expect(page.locator("[data-users-open-sessions]")).toHaveCount(0)
    await expect(page.locator("[data-users-open-email]")).toHaveCount(0)
    await expect(page.locator("[data-users-session]")).toHaveCount(0)
  })

  test("блокировка предупреждает о статьях и плане, закрывает доступ и архивирует материалы", async ({ page }) => {
    await authorize(page, "admin")

    await page.goto(`/admin/users/${TARGET_ID}`)
    await page.locator("[data-users-open-archive]").click()

    await expect(page.locator("[data-users-dialog-articles]")).toContainText("2")
    await expect(page.locator("[data-users-dialog-plan]")).toContainText("2026")

    await page.locator("[data-users-reason-category]").selectOption("rules_violation")
    await page.locator("[data-users-public-message]").fill("Материалы нарушают правила публикации")
    await page.locator("[data-users-internal-reason]").fill("Повторное нарушение после предупреждения")
    await page.locator("[data-users-confirm-archive]").click()

    await expect(page.locator(`[data-users-card="${TARGET_ID}"]`)).toHaveAttribute("data-users-status", "archived")
    await expect(page.locator("[data-users-notice]")).toBeVisible()
    await expect(page.locator("[data-users-card-category]")).toBeVisible()

    const saved = await prisma.user.findUniqueOrThrow({ where: { id: TARGET_ID } })
    expect(saved.archiveMode).toBe("admin")
    expect(saved.archiveReasonCategory).toBe("rules_violation")
    expect(saved.archivePublicMessage).toBe("Материалы нарушают правила публикации")
    // Оплаченный план продолжает идти без возврата (журнал #50).
    expect(saved.planUntil?.toISOString()).toBe(PLAN_UNTIL.toISOString())

    const articles = await prisma.article.findMany({ where: { id: { in: articleIds } } })
    for (const article of articles) {
      expect(article.status).toBe("archived")
      expect(article.archivedByActorId).toBe(staffIds.admin)
      expect(article.archivedByRole).toBe("admin")
    }
    expect(await prisma.session.count({ where: { userId: TARGET_ID, revokedAt: null } })).toBe(0)

    const archived = await prisma.auditLog.findFirstOrThrow({
      where: { action: "user.archive", entityId: TARGET_ID },
      orderBy: { createdAt: "desc" }
    })
    expect(archived.diff).toMatchObject({ mode: "admin", cascadeArticles: 2, sessionsRevoked: 2 })
  })

  test("закрытый доступ сразу отдаёт 410 на публичной странице автора", async ({ page }) => {
    const response = await page.goto(`/authors/${TARGET_HANDLE}`)

    expect(response?.status()).toBe(410)
  })

  test("§9 «Конфликт»: повторная блокировка уже закрытого аккаунта", async ({ page }) => {
    await authorize(page, "owner")

    await page.goto(`/admin/users/${TARGET_ID}`)
    // Кнопки блокировки у закрытого аккаунта нет — конфликт воспроизводится прямым запросом
    // той же мутации: так карточка показывает строку «объект изменён другим администратором».
    await expect(page.locator("[data-users-open-archive]")).toHaveCount(0)

    const conflict = await page.request.post("/api/graphql", {
      headers: { authorization: `Bearer ${signAccessToken(staffIds.owner, staffSessions.owner)}` },
      data: {
        query: `mutation($id: ID!) {
          archiveAccount(id: $id, reasonCategory: rules_violation, internalReason: "Повтор") { id }
        }`,
        variables: { id: TARGET_ID }
      }
    })
    const body = (await conflict.json()) as { errors?: Array<{ extensions?: { code?: string } }> }
    expect(body.errors?.[0]?.extensions?.code).toBe("CONFLICT")
  })

  test("восстановление возвращает доступ и оставляет материалы в архиве", async ({ page }) => {
    await authorize(page, "admin")

    await page.goto(`/admin/users/${TARGET_ID}`)
    await page.locator("[data-users-open-restore]").click()
    await expect(page.locator("[data-users-dialog-articles-stay]")).toBeVisible()
    await page.locator("[data-users-restore-reason]").fill("Решение принято после разбора")
    await page.locator("[data-users-confirm-restore]").click()

    await expect(page.locator(`[data-users-card="${TARGET_ID}"]`)).toHaveAttribute("data-users-status", "active")

    const saved = await prisma.user.findUniqueOrThrow({ where: { id: TARGET_ID } })
    expect(saved.archivedAt).toBeNull()
    expect(saved.archiveReasonCategory).toBeNull()
    // Статьи остаются в архиве: автор возвращает их сам (журнал §5.4, §25.7).
    expect(await prisma.article.count({ where: { id: { in: articleIds }, status: "archived" } })).toBe(2)

    const restored = await prisma.auditLog.findFirstOrThrow({
      where: { action: "user.restore", entityId: TARGET_ID },
      orderBy: { createdAt: "desc" }
    })
    expect(restored.diff).toMatchObject({ mode: "admin", articlesLeftArchived: 2 })
  })

  test("§9 «Конфликт»: повторное восстановление действующего аккаунта", async ({ page }) => {
    await authorize(page, "owner")

    const conflict = await page.request.post("/api/graphql", {
      headers: { authorization: `Bearer ${signAccessToken(staffIds.owner, staffSessions.owner)}` },
      data: {
        query: `mutation($id: ID!) { restoreAccount(id: $id, reason: "Повтор") { id } }`,
        variables: { id: TARGET_ID }
      }
    })
    const body = (await conflict.json()) as { errors?: Array<{ extensions?: { code?: string } }> }
    expect(body.errors?.[0]?.extensions?.code).toBe("CONFLICT")
  })

  test("экстренная блокировка предупреждает о немедленном действии и пишет свой режим", async ({ page }) => {
    await authorize(page, "owner")

    await page.goto(`/admin/users/${RESTORE_ID}`)
    await page.locator("[data-users-open-emergency]").click()

    await expect(page.locator("[data-users-dialog-emergency]")).toBeVisible()
    await page.locator("[data-users-reason-category]").selectOption("security_threat")
    await page.locator("[data-users-internal-reason]").fill("Признаки взлома аккаунта")
    await page.locator("[data-users-confirm-archive]").click()

    await expect(page.locator(`[data-users-card="${RESTORE_ID}"]`)).toHaveAttribute("data-users-status", "archived")
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: RESTORE_ID } })
    expect(saved.archiveMode).toBe("emergency")
    expect(saved.archiveReasonCategory).toBe("security_threat")
  })

  test("отзыв сессий закрывает сессии и оставляет аккаунт активным", async ({ page }) => {
    await authorize(page, "admin")
    await createSessionId(prisma, EMAIL_ID)

    await page.goto(`/admin/users/${EMAIL_ID}`)
    await page.locator("[data-users-open-sessions]").click()
    await page.locator("[data-users-confirm-sessions]").click()

    await expect(page.locator("[data-users-notice]")).toBeVisible()
    expect(await prisma.session.count({ where: { userId: EMAIL_ID, revokedAt: null } })).toBe(0)
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: EMAIL_ID } })
    expect(saved.archivedAt).toBeNull()

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "user.sessions.revoke", entityId: EMAIL_ID },
      orderBy: { createdAt: "desc" }
    })
    expect(audit.actorId).toBe(staffIds.admin)
  })

  test("сотрудник меняет адрес по обращению о восстановлении доступа", async ({ page }) => {
    await authorize(page, "owner")
    const newEmail = "t073.recovered@example.test"
    await prisma.user.deleteMany({ where: { email: newEmail } })

    await page.goto(`/admin/users/${EMAIL_ID}`)
    await page.locator("[data-users-open-email]").click()
    await page.locator("[data-users-new-email]").fill(newEmail)
    await page.locator("[data-users-email-reason]").fill("Личность проверена по обращению")
    await page.locator("[data-users-confirm-email]").click()

    await expect(page.locator("[data-users-notice]")).toBeVisible()
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: EMAIL_ID } })
    expect(saved.email).toBe(newEmail)

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "user.email.change", entityId: EMAIL_ID },
      orderBy: { createdAt: "desc" }
    })
    // Адрес в журнале раздела хранится хэшем (`users.md` §8).
    expect(JSON.stringify(audit.diff)).not.toContain(newEmail)
    expect(audit.diff).toMatchObject({ via: "admin", reason: "Личность проверена по обращению" })
  })
})
