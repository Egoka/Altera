import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import { uniqueEmail, withPrisma } from "./helpers/auth-fixtures"
import { createSessionId, signAccessToken } from "./helpers/session-token"
import { SESSION_ACCESS_COOKIE } from "../../shared/session"

/**
 * T-032: смена почты по коду (docs/spec/30-account/reader/email-change.md).
 * AC-1 проверяется на живой базе и живой почте: после смены адреса ни одна сессия не отозвана.
 * AC-2 — строки состояний §8; те из них, что зависят от отказа сервера, снимаются подстановкой
 * ответа на `/api/graphql`: лимит «1 запрос в сутки» иначе воспроизводится только ожиданием суток.
 *
 * Вход здесь не проходит по ссылке намеренно: сессия кладётся в базу напрямую, чтобы сценарий не
 * расходовал общую корзину `auth.verify.ip` (`rate-limits.md` §2 п. 3) вместе со сценариями T-022.
 */

const mailpitUrl = process.env.T021_MAILPIT_URL ?? "http://127.0.0.1:28025"

interface AuthenticatedAccount {
  id: string
  email: string
  sessionIds: string[]
}

/** Несколько сессий одного аккаунта: AC-1 требует, чтобы после смены выжили все. */
const createAccountWithSessions = async (prefix: string, sessions = 2): Promise<AuthenticatedAccount> =>
  withPrisma(async (prisma) => {
    const handle = `${prefix}-${Math.random().toString(16).slice(2, 10)}`
    await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
    const user = await prisma.user.create({ data: { email: uniqueEmail(prefix), handle, name: "T032 account" } })
    await prisma.handleHistory.update({ where: { handle }, data: { userId: user.id } })

    const sessionIds: string[] = []
    for (let index = 0; index < sessions; index += 1) sessionIds.push(await createSessionId(prisma, user.id))

    return { id: user.id, email: user.email, sessionIds }
  })

const useSession = async (page: Page, account: AuthenticatedAccount): Promise<void> => {
  await page.context().addCookies([
    {
      name: SESSION_ACCESS_COOKIE,
      value: signAccessToken(account.id, account.sessionIds[0]!),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }
  ])
}

const readEmailChangeCode = async (request: APIRequestContext, email: string): Promise<string> => {
  const deadline = Date.now() + 20_000

  for (;;) {
    const search = await request.get(`${mailpitUrl}/api/v1/search`, { params: { query: `to:"${email}"` } })
    const messages = ((await search.json()) as { messages: { ID: string }[] }).messages

    for (const message of messages) {
      const delivered = (await (await request.get(`${mailpitUrl}/api/v1/message/${message.ID}`)).json()) as {
        Text: string
      }
      const code = delivered.Text.match(/(?:Код|Code):\s*(\d{6})/)?.[1]
      if (code) return code
    }

    if (Date.now() > deadline) throw new Error(`No confirmation code delivered to ${email}`)
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

// Шаги 1–3 flow #13: смена адреса самообслуживанием. Шаги Р1–Р3 (обращение в редакцию и ручная
// процедура сотрудника) в T-032 не входят и остаются в `13-email-change-recovery.spec.ts`.
test("flow #13 шаги 1–3: адрес меняется по коду, сессии остаются активными", async ({ page, request }) => {
  const account = await createAccountWithSessions("t032-change")
  const newEmail = uniqueEmail("t032-new")
  await useSession(page, account)

  await test.step("Шаг 1: запросить код на новый адрес", async () => {
    await page.goto("/me/email")
    await expect(page.locator("[data-email-change-state='ready']")).toBeVisible()
    await expect(page.getByTestId("email-change-current")).toContainText("•••")

    await page.getByTestId("email-change-address").fill(newEmail)
    await page.getByTestId("email-change-send").click()
    await expect(page.locator("[data-email-change-variant='code']")).toBeVisible()
  })

  await test.step("Шаг 2: ввести код в том же окне", async () => {
    await page.getByTestId("email-change-code").fill(await readEmailChangeCode(request, newEmail))
    await page.getByTestId("email-change-confirm").click()
    await expect(page.getByTestId("email-change-changed")).toBeVisible()
  })

  await test.step("Шаг 3: адрес изменён, повторный вход не нужен, уведомление ушло на прежний", async () => {
    // Страница перечитывается той же сессией: если бы сессию отозвали, здесь был бы уход на вход.
    await page.reload()
    await expect(page).toHaveURL(/\/me\/email$/)
    await expect(page.locator("[data-email-change-state='ready']")).toBeVisible()
    await expect(page.locator("[data-email-change-variant='address']")).toBeVisible()

    const changed = await withPrisma((prisma) => prisma.user.findUnique({ where: { id: account.id } }))
    expect(changed!.email).toBe(newEmail)

    // AC-1: ни одна сессия не отозвана и новых не выдано.
    const after = await withPrisma((prisma) => prisma.session.findMany({ where: { userId: account.id } }))
    expect(after.map((session) => session.id).sort()).toEqual([...account.sessionIds].sort())
    expect(after.every((session) => session.revokedAt === null)).toBe(true)

    const audited = await withPrisma((prisma) =>
      prisma.auditLog.findMany({ where: { action: "user.email.change", entityId: account.id } })
    )
    expect(audited).toHaveLength(1)
    expect(audited[0]!.diff).toMatchObject({ via: "self", newEmail })

    const notice = await request.get(`${mailpitUrl}/api/v1/search`, { params: { query: `to:"${account.email}"` } })
    const subjects = ((await notice.json()) as { messages: { Subject: string }[] }).messages.map(
      (message) => message.Subject
    )
    expect(subjects).toContain("Адрес аккаунта Altera изменён")

    // Открытый запрос закрыт: повторного кода на экране нет.
    const pending = await withPrisma((prisma) =>
      prisma.emailChangeRequest.findUnique({ where: { userId: account.id } })
    )
    expect(pending).toBeNull()
  })
})

test("строка «Нет доступа»: гость уводится на вход с путём возврата", async ({ page }) => {
  await page.goto("/me/email")

  await expect(page).toHaveURL(/\/login\?next=\/me\/email$/)
})

test("строки состояний §8: ошибка данных, лимит, истёкший код и занятый адрес", async ({ page }) => {
  const account = await createAccountWithSessions("t032-states", 1)
  await useSession(page, account)

  const state = (pending: Record<string, unknown> | null) => ({
    currentEmailMasked: "t•••@example.test",
    pending
  })
  const meWith = (pending: Record<string, unknown> | null) => ({
    data: { me: { id: account.id, email: account.email, emailChange: state(pending) } }
  })
  let reply: Record<string, unknown> = { data: null, errors: [{ extensions: { code: "INTERNAL_ERROR" } }] }
  let read: Record<string, unknown> = meWith(null)

  await page.route("**/api/graphql", async (route) => {
    const body = route.request().postDataJSON() as { query: string }
    const payload = body.query.includes("query GetMyEmailChange") ? read : reply
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) })
  })

  await test.step("Ошибка данных: чтение не ответило", async () => {
    read = { data: null, errors: [{ extensions: { code: "INTERNAL_ERROR", requestId: "req-t032" } }] }
    await page.goto("/me/email")
    await expect(page.locator("[data-email-change-state='data_error']")).toBeVisible()
  })

  await test.step("Ограничение: лимит запросов кода называет время следующей попытки", async () => {
    read = meWith(null)
    reply = { data: null, errors: [{ extensions: { code: "RATE_LIMITED", retryAfter: 3600 } }] }
    await page.goto("/me/email")
    await page.getByTestId("email-change-address").fill("taken@example.test")
    await page.getByTestId("email-change-send").click()
    await expect(page.getByTestId("email-change-error")).toContainText("60")
  })

  await test.step("Не найдено: истёкший код остаётся в зоне 4 с предложением отправить ещё раз", async () => {
    read = meWith({
      newEmailMasked: "n•••@example.test",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      attemptsLeft: 10
    })
    await page.goto("/me/email")
    await expect(page.getByTestId("email-change-expired")).toBeVisible()
    await expect(page.getByTestId("email-change-confirm")).toBeDisabled()
    await expect(page.getByTestId("email-change-resend")).toBeVisible()
  })

  await test.step("Конфликт: адрес занят другим аккаунтом — сообщение на шаге кода", async () => {
    read = meWith({
      newEmailMasked: "n•••@example.test",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      attemptsLeft: 10
    })
    reply = { data: null, errors: [{ extensions: { code: "CONFLICT", entity: "user" } }] }
    await page.goto("/me/email")
    await page.getByTestId("email-change-code").fill("123456")
    await page.getByTestId("email-change-confirm").click()
    await expect(page.getByTestId("email-change-error")).toBeVisible()
  })
})
