import { createHash } from "node:crypto"
import { SESSION_ACCESS_COOKIE, SESSION_REFRESH_COOKIE } from "../../shared/session"
import { uniqueEmail, withPrisma } from "./helpers/auth-fixtures"
import { createSession, signAccessToken } from "./helpers/session-token"
import { expect, test, type BrowserContext, type Page } from "./helpers/test"

/**
 * T-124: сессия не теряется через 15 минут. AC-1 — страница кабинета открывается без повторного
 * входа, когда access уже истёк, а refresh жив (`docs/spec/50-access/session-lifecycle.md` §2.5,
 * ADR-0023 п. 3). AC-3 — одновременные запросы двух вкладок с одной cookie не выглядят кражей
 * и не завершают сессию (§2.4).
 *
 * «Прошло 16 минут» подменяется наблюдаемым состоянием браузера: access-cookie живёт 15 минут,
 * поэтому её либо уже нет в запросе, либо она несёт истёкший токен. Вход по ссылке здесь не
 * проходится — сессия и её refresh-токен создаются прямо в базе, чтобы сценарий не расходовал
 * общую корзину `auth.verify.ip` (`rate-limits.md` §2 п. 3).
 */
const hashToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex")

interface Reader {
  id: string
  sessionId: string
  refreshToken: string
}

const createReader = (prefix: string): Promise<Reader> =>
  withPrisma(async (prisma) => {
    const handle = `${prefix}-${Math.random().toString(16).slice(2, 10)}`
    await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
    const user = await prisma.user.create({
      data: { email: uniqueEmail(prefix), handle, name: "Анна Тестова", role: "reader" }
    })
    await prisma.handleHistory.update({ where: { handle }, data: { userId: user.id } })
    const session = await createSession(prisma, user.id)

    return { id: user.id, sessionId: session.sessionId, refreshToken: session.refreshToken }
  })

/** Состояние браузера через 16 минут: refresh-cookie жива, access — истёкшая либо уже стёртая. */
const useStaleSession = async (
  context: BrowserContext,
  reader: Reader,
  options: { expiredAccess?: boolean } = {}
): Promise<void> => {
  const shared = { domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" as const }
  await context.addCookies([
    { ...shared, name: SESSION_REFRESH_COOKIE, value: reader.refreshToken },
    ...(options.expiredAccess
      ? [{ ...shared, name: SESSION_ACCESS_COOKIE, value: signAccessToken(reader.id, reader.sessionId, -60) }]
      : [])
  ])
}

const cookieValue = async (context: BrowserContext, name: string): Promise<string | undefined> =>
  (await context.cookies()).find((cookie) => cookie.name === name)?.value

const storedSession = (sessionId: string) =>
  withPrisma((prisma) => prisma.session.findUniqueOrThrow({ where: { id: sessionId } }))

const callGraphQL = (page: Page, query: string): Promise<{ data?: Record<string, unknown> | null }> =>
  page.evaluate(
    async (request) => {
      const response = await fetch("/api/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request)
      })
      return response.json() as Promise<{ data?: Record<string, unknown> | null }>
    },
    { query }
  )

test("AC-1: кабинет открывается через 16 минут без повторного входа", async ({ page, context }) => {
  const reader = await createReader("t124-ssr")
  await useStaleSession(context, reader)

  await page.goto("/me")

  await expect(page, "истёкший access не уводит вошедшего на вход").toHaveURL(/\/me$/)
  await expect(page.getByTestId("dashboard-articles")).toBeVisible()

  const access = await cookieValue(context, SESSION_ACCESS_COOKIE)
  expect(access, "BFF выдал новый access взамен истёкшего").toBeTruthy()
  const refresh = await cookieValue(context, SESSION_REFRESH_COOKIE)
  expect(refresh, "refresh ротирован").not.toBe(reader.refreshToken)

  const session = await storedSession(reader.sessionId)
  expect(session.tokenHash).toBe(hashToken(refresh!))
  expect(session.previousTokenHash).toBe(hashToken(reader.refreshToken))
  expect(session.revokedAt, "сессия осталась живой").toBeNull()
})

test("AC-1: страница с истёкшим токеном получает данные после обмена, а не отказ", async ({ page, context }) => {
  const reader = await createReader("t124-retry")
  await useStaleSession(context, reader, { expiredAccess: true })

  await page.goto("/me")

  await expect(page).toHaveURL(/\/me$/)
  await expect(page.getByTestId("dashboard-articles")).toBeVisible()
  expect(await cookieValue(context, SESSION_REFRESH_COOKIE)).not.toBe(reader.refreshToken)
})

test("AC-3: одновременные запросы двух вкладок не завершают сессию", async ({ page, context, browser }) => {
  const reader = await createReader("t124-tabs")
  const second = await browser.newContext()
  const secondPage = await second.newPage()
  // Страницы открываются гостями: обмен должен случиться ровно на паре запросов ниже.
  await page.goto("/")
  await secondPage.goto("/")

  // Обе вкладки держат один и тот же истёкший access и один и тот же refresh: именно так их
  // застаёт пробуждение ноутбука.
  await useStaleSession(context, reader, { expiredAccess: true })
  await useStaleSession(second, reader, { expiredAccess: true })

  const answers = await Promise.all([callGraphQL(page, "{ me { id } }"), callGraphQL(secondPage, "{ me { id } }")])

  try {
    expect(answers.map((answer) => (answer.data?.me as { id: string } | null)?.id)).toEqual([reader.id, reader.id])
    const session = await storedSession(reader.sessionId)
    expect(session.revokedAt, "общий обмен в BFF не читается сервером как кража").toBeNull()
    expect(session.previousTokenHash, "обмен был один").toBe(hashToken(reader.refreshToken))
  } finally {
    await second.close()
  }
})
