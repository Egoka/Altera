import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "./helpers/test"
import { PrismaClient } from "../../../server/src/generated/prisma/index.js"

// T-023: ротация refresh, выход и httpOnly-cookie через BFF. Refresh никогда не попадает
// в браузерный JS (ADR-0023 п. 2), а повторное предъявление ротированного токена отзывает
// все сессии пользователя (ADR-0009 п. 3).
const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const mailpitUrl = process.env.T021_MAILPIT_URL ?? "http://127.0.0.1:28025"
const REFRESH_COOKIE = "altera_refresh"

interface GraphQLCall {
  status: number
  body: { data?: Record<string, unknown> | null; errors?: { message: string }[] }
}

const callGraphQL = (page: Page, query: string, variables: Record<string, unknown> = {}): Promise<GraphQLCall> =>
  page.evaluate(
    async (request) => {
      const response = await fetch("/api/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request)
      })
      return { status: response.status, body: await response.json() }
    },
    { query, variables }
  )

const refreshCookie = async (context: BrowserContext) =>
  (await context.cookies()).find((cookie) => cookie.name === REFRESH_COOKIE)

async function magicLinkToken(
  page: Page,
  request: APIRequestContext,
  email: string,
  expectedLetters = 1
): Promise<string> {
  // T-022: ссылка запрашивается вместе с версиями согласия, принятыми на странице входа,
  // а ответ одинаков для известного и неизвестного адреса (`20-public/login.md` §4).
  const legal = await callGraphQL(
    page,
    "query ($locale: Locale!) { legalVersions(locale: $locale) { termsVersion privacyVersion } }",
    { locale: "ru" }
  )
  const consentVersion = legal.body.data?.legalVersions

  const requested = await callGraphQL(
    page,
    "mutation ($email: String!, $consentVersion: ConsentVersionsInput!, $locale: Locale!) { requestMagicLink(email: $email, consentVersion: $consentVersion, locale: $locale) { ok retryAfterSec } }",
    { email, consentVersion, locale: "ru" }
  )
  expect(requested.body.data).toEqual({ requestMagicLink: { ok: true, retryAfterSec: null } })

  // Mailpit отдаёт письма от новых к старым; ждём именно то, которое запросил этот шаг.
  let messages: { ID: string }[] = []
  await expect
    .poll(
      async () => {
        const search = await request.get(`${mailpitUrl}/api/v1/search`, { params: { query: `to:"${email}"` } })
        messages = ((await search.json()) as { messages: { ID: string }[] }).messages
        return messages.length
      },
      { timeout: 15_000 }
    )
    .toBe(expectedLetters)

  const delivered = (await (await request.get(`${mailpitUrl}/api/v1/message/${messages[0]!.ID}`)).json()) as {
    Text: string
  }
  const token = delivered.Text.match(/\/auth\/verify\?token=([0-9a-f]{64})/)?.[1]
  expect(token).toBeTruthy()
  return token!
}

// T-022: подтверждение ссылки отвечает исходом входа, а сессия лежит внутри него.
const LOGIN = `mutation ($token: String!) {
  verifyMagicLink(token: $token) {
    outcome
    session { accessToken refreshToken user { id } }
  }
}`
const REFRESH = `mutation ($refreshToken: String! = "") {
  refreshSession(refreshToken: $refreshToken) { accessToken refreshToken user { id } }
}`

test("вход выдаёт httpOnly-cookie, ротирует её и отзывает все сессии при повторном предъявлении", async ({
  page,
  context,
  request
}) => {
  const email = `t023-rotation-${Date.now()}@example.test`
  await page.goto("/", { waitUntil: "networkidle" })
  const token = await magicLinkToken(page, request, email)

  const login = await callGraphQL(page, LOGIN, { token })
  const verified = login.body.data?.verifyMagicLink as {
    outcome: string
    session: { accessToken: string; refreshToken: string | null } | null
  }
  expect(verified.outcome, "первый вход заводит аккаунт и сразу открывает сессию").toBe("authenticated")
  const session = verified.session!
  expect(session.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/)
  expect(session.refreshToken, "BFF снимает refresh из ответа").toBeNull()

  const issued = await refreshCookie(context)
  expect(issued, "BFF выставил cookie сессии").toBeTruthy()
  expect(issued!.httpOnly).toBe(true)
  expect(issued!.sameSite).toBe("Lax")

  const browserCookies = await page.evaluate(() => document.cookie)
  expect(browserCookies, "refresh недоступен из JavaScript").not.toContain(REFRESH_COOKIE)
  expect(browserCookies).not.toContain(issued!.value)

  const refreshed = await callGraphQL(page, REFRESH)
  const rotated = refreshed.body.data?.refreshSession as { accessToken: string; refreshToken: string | null }
  expect(rotated.accessToken).toBeTruthy()
  expect(rotated.refreshToken).toBeNull()
  const afterRotation = await refreshCookie(context)
  expect(afterRotation!.value).not.toBe(issued!.value)

  // Кража: злоумышленник предъявляет уже ротированный токен.
  await context.addCookies([{ ...issued!, value: issued!.value }])
  const reuse = await callGraphQL(page, REFRESH)
  expect(reuse.body.data?.refreshSession ?? null).toBeNull()
  expect(reuse.body.errors?.[0]?.message).toBe("Authentication required")
  expect(await refreshCookie(context), "мёртвая cookie стирается").toBeFalsy()

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  try {
    const sessions = await prisma.session.findMany({ where: { user: { email } } })
    expect(sessions.length).toBeGreaterThan(0)
    expect(
      sessions.every((row) => row.revokedAt !== null),
      "все сессии пользователя отозваны"
    ).toBe(true)
  } finally {
    await prisma.$disconnect()
  }
})

test("logoutAll стирает cookie и не оставляет активных сессий", async ({ page, context, request }) => {
  const email = `t023-logout-${Date.now()}@example.test`
  await page.goto("/", { waitUntil: "networkidle" })

  const first = await callGraphQL(page, LOGIN, { token: await magicLinkToken(page, request, email) })
  const accessToken = (first.body.data?.verifyMagicLink as { session: { accessToken: string } }).session.accessToken
  // Вторая сессия того же пользователя: её тоже обязан закрыть `logoutAll`.
  const second = await context.browser()!.newContext()
  const secondPage = await second.newPage()
  await secondPage.goto("/", { waitUntil: "networkidle" })
  await callGraphQL(secondPage, LOGIN, { token: await magicLinkToken(secondPage, request, email, 2) })
  expect(await refreshCookie(second)).toBeTruthy()

  const result = await page.evaluate(async (bearer) => {
    const response = await fetch("/api/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ query: "mutation { logoutAll }" })
    })
    return response.json()
  }, accessToken)

  expect(result).toEqual({ data: { logoutAll: true } })
  expect(await refreshCookie(context), "cookie выхода стёрта").toBeFalsy()

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  try {
    const sessions = await prisma.session.findMany({ where: { user: { email } } })
    expect(sessions).toHaveLength(2)
    expect(sessions.every((row) => row.revokedAt !== null)).toBe(true)
  } finally {
    await prisma.$disconnect()
    await second.close()
  }
})
