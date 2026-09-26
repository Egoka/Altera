import { expect, test, type Page, type Request } from "./helpers/test"
import { ensurePublishedLegalVersions, readMagicLinkToken, uniqueEmail, withPrisma } from "./helpers/auth-fixtures"

/**
 * T-123: вход по ссылке из письма. Веб-почта живёт на другом домене, поэтому переход по ссылке
 * приходит с `Sec-Fetch-Site: cross-site` (AC-2), а refresh-cookie обязана оказаться в браузере
 * после SSR-обмена токена (AC-3, ADR-0023 п. 2). Проверка идёт на настоящем сервере: мок BFF
 * ни заголовков перехода, ни `Set-Cookie` внутреннего подзапроса не воспроизводит.
 */
const REFRESH_COOKIE = "altera_refresh"
const WEBMAIL_ORIGIN = "http://webmail.test"

const LOGIN = `mutation ($token: String!) {
  verifyMagicLink(token: $token) { outcome session { accessToken refreshToken user { id } } }
}`
const REFRESH = `mutation ($refreshToken: String! = "") {
  refreshSession(refreshToken: $refreshToken) { accessToken refreshToken }
}`

const crossSiteHeaders = {
  "content-type": "application/json",
  origin: WEBMAIL_ORIGIN,
  "sec-fetch-site": "cross-site",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document"
}

/** Запрашивает ссылку входа тем же путём, которым её запрашивает страница `/login`. */
const requestLink = async (page: Page, email: string): Promise<void> => {
  const ok = await page.evaluate(async (address) => {
    const call = async (query: string, variables: Record<string, unknown>) => {
      const response = await fetch("/api/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables })
      })
      return (await response.json()) as { data?: Record<string, never> }
    }

    const legal = await call(
      "query ($locale: Locale!) { legalVersions(locale: $locale) { termsVersion privacyVersion } }",
      {
        locale: "ru"
      }
    )
    const requested = await call(
      "mutation ($email: String!, $consentVersion: ConsentVersionsInput!, $locale: Locale!) { requestMagicLink(email: $email, consentVersion: $consentVersion, locale: $locale) { ok } }",
      { email: address, consentVersion: legal.data?.legalVersions, locale: "ru" }
    )
    return Boolean((requested.data?.requestMagicLink as { ok?: boolean } | undefined)?.ok)
  }, email)

  expect(ok, "ссылка входа запрошена").toBe(true)
}

test("переход по ссылке из веб-почты завершает вход и оставляет httpOnly refresh-cookie", async ({
  page,
  context,
  request
}) => {
  await ensurePublishedLegalVersions()
  const email = uniqueEmail("t123-webmail")

  await page.goto("/")
  await requestLink(page, email)
  const token = await readMagicLinkToken(request, email)

  // Страница письма на чужом домене: переход с неё Chromium помечает как межсайтовый.
  await page.route(`${WEBMAIL_ORIGIN}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="ru"><body><a id="login-link" href="/auth/verify?token=${token}">Войти</a></body></html>`
    })
  )

  const verifyNavigations: Request[] = []
  page.on("request", (incoming) => {
    if (incoming.isNavigationRequest() && incoming.url().includes("/auth/verify")) verifyNavigations.push(incoming)
  })

  await page.goto(`${WEBMAIL_ORIGIN}/inbox`, { waitUntil: "commit" })
  await page.locator("#login-link").evaluate((link, origin) => {
    ;(link as HTMLAnchorElement).href = `${origin}${(link as HTMLAnchorElement).getAttribute("href")}`
  }, "http://127.0.0.1:4173")
  await page.locator("#login-link").click()
  await page.waitForURL(/\/me(?:\?|$)/)

  expect(verifyNavigations, "переход по ссылке дошёл до /auth/verify").not.toHaveLength(0)
  // `Referer` доказывает, что переход действительно пришёл с чужого домена: Chromium помечает
  // такой переход `Sec-Fetch-Site: cross-site`, и SSR пересылает заголовок в BFF. Сам заголовок
  // здесь не проверяется — при активном перехвате Playwright не показывает добавленные браузером
  // `Sec-Fetch-*`; с ними на настоящем сервере работает второй сценарий файла. Без исключения для
  // обмена токена этот переход остаётся на `/auth/verify` с состоянием ошибки.
  const navigation = await verifyNavigations[0]!.allHeaders()
  expect(navigation["referer"]).toContain("webmail.test")

  const issued = (await context.cookies()).find((cookie) => cookie.name === REFRESH_COOKIE)
  expect(issued, "после входа через /auth/verify браузер получил refresh-cookie").toBeTruthy()
  expect(issued!.httpOnly).toBe(true)
  expect(issued!.sameSite).toBe("Lax")
  expect(await page.evaluate(() => document.cookie), "refresh недоступен из JavaScript").not.toContain(REFRESH_COOKIE)

  // Cookie содержит настоящий refresh сессии: обновление её ротирует.
  const rotated = await page.evaluate(async (query) => {
    const response = await fetch("/api/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query })
    })
    return (await response.json()) as { data?: { refreshSession?: { accessToken: string } | null } }
  }, REFRESH)
  expect(rotated.data?.refreshSession?.accessToken, "refresh из cookie принят API").toBeTruthy()
  const afterRotation = (await context.cookies()).find((cookie) => cookie.name === REFRESH_COOKIE)
  expect(afterRotation!.value).not.toBe(issued!.value)

  const sessions = await withPrisma((prisma) => prisma.session.findMany({ where: { user: { email } } }))
  expect(sessions).toHaveLength(1)
})

test("BFF пропускает межсайтовый обмен токена и отклоняет остальные межсайтовые мутации", async ({ page, request }) => {
  await ensurePublishedLegalVersions()
  const email = uniqueEmail("t123-csrf")

  await page.goto("/")
  await requestLink(page, email)
  const token = await readMagicLinkToken(request, email)

  const rejected = await request.post("/api/graphql", {
    headers: crossSiteHeaders,
    data: { query: "mutation { logoutAll }" }
  })
  expect(rejected.status(), "межсайтовая мутация, не являющаяся обменом токена, отклонена").toBe(403)

  const background = await request.post("/api/graphql", {
    headers: { ...crossSiteHeaders, "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" },
    data: { query: LOGIN, variables: { token } }
  })
  expect(background.status(), "фоновый межсайтовый обмен исключения не получает").toBe(403)

  const accepted = await request.post("/api/graphql", {
    headers: crossSiteHeaders,
    data: { query: LOGIN, variables: { token } }
  })
  expect(accepted.status()).toBe(200)
  const body = (await accepted.json()) as {
    data?: { verifyMagicLink?: { outcome: string; session: { refreshToken: string | null } | null } }
  }
  expect(body.data?.verifyMagicLink?.outcome).toBe("authenticated")
  expect(body.data?.verifyMagicLink?.session?.refreshToken, "BFF снимает refresh из ответа").toBeNull()
  expect(accepted.headers()["set-cookie"]).toContain(REFRESH_COOKIE)

  const sessions = await withPrisma((prisma) => prisma.session.findMany({ where: { user: { email } } }))
  expect(sessions).toHaveLength(1)
})
