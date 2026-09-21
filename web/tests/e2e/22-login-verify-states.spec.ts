import { expect, test, type Page } from "@playwright/test"
import {
  createArchivedUser,
  ensurePublishedLegalVersions,
  readMagicLinkToken,
  uniqueEmail,
  withPrisma
} from "./helpers/auth-fixtures"

// Таблицы состояний: docs/spec/20-public/login.md §8 и docs/spec/20-public/verify.md §8.
// Строки, помеченные в спецификации как «не применимо», проверяются тем, что страница
// действительно ведёт себя иначе (редирект вместо экрана).

const GRAPHQL_ROUTE = "**/api/graphql"

// У Nuxt есть собственный route announcer с role="alert", поэтому сообщения страницы
// ищутся внутри её секции.
const pageAlert = (page: Page) => page.locator("[data-login-state] [role='alert']")

const graphqlErrorBody = (operation: string, extensions: Record<string, unknown>) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    data: { [operation]: null },
    errors: [{ message: "stubbed", path: [operation], extensions }]
  })
})

const readOperation = (postData: string | null): string => {
  if (!postData) return ""
  try {
    return (JSON.parse(postData) as { query?: string }).query ?? ""
  } catch {
    return ""
  }
}

// До гидратации Vue не видит введённых значений и кнопка остаётся неактивной, поэтому
// заполнение всегда начинается с ожидания состояния `form`.
const requestLinkFrom = async (page: Page, email: string) => {
  await expect(page.locator("[data-login-state='form']")).toBeVisible()
  await page.getByLabel(/адрес электронной почты/i).fill(email)
  await page.getByRole("checkbox").check()
  await page.getByRole("button", { name: /получить ссылку входа/i }).click()
}

test.describe("страница входа по таблице состояний", () => {
  test.beforeEach(async () => {
    await ensurePublishedLegalVersions()
  })

  test("«Загрузка»: пока версии согласия не получены, отправка недоступна", async ({ page }) => {
    await page.route(GRAPHQL_ROUTE, async (route) => {
      if (readOperation(route.request().postData()).includes("LegalVersions")) {
        await new Promise((resolve) => setTimeout(resolve, 1_500))
      }
      await route.continue()
    })

    await page.goto("/login")

    await expect(page.locator("[data-login-state='loading']")).toBeVisible()
    await expect(page.getByRole("button", { name: /получить ссылку входа/i })).toBeDisabled()
    await expect(page.locator("[data-login-state='form']")).toBeVisible({ timeout: 10_000 })
  })

  test("«Ошибка данных»: без версий согласия форма не предлагается", async ({ page }) => {
    await page.route(GRAPHQL_ROUTE, async (route) => {
      if (readOperation(route.request().postData()).includes("LegalVersions")) {
        await route.fulfill(graphqlErrorBody("legalVersions", { code: "INTERNAL_ERROR", requestId: "req-stub" }))
        return
      }
      await route.continue()
    })

    await page.goto("/login")

    await expect(page.locator("[data-login-state='data_error']")).toBeVisible()
    await expect(page.getByRole("checkbox")).toHaveCount(0)
  })

  test("«Ограничение плана»: превышенный лимит показывает пояснение и время", async ({ page }) => {
    await page.route(GRAPHQL_ROUTE, async (route) => {
      if (readOperation(route.request().postData()).includes("RequestMagicLink")) {
        await route.fulfill(
          graphqlErrorBody("requestMagicLink", { code: "RATE_LIMITED", retryAfter: 600, requestId: "req-stub" })
        )
        return
      }
      await route.continue()
    })

    await page.goto("/login")
    await expect(page.locator("[data-login-state='form']")).toBeVisible()
    await requestLinkFrom(page, uniqueEmail("t022-rate"))

    await expect(pageAlert(page)).toContainText(/слишком много запросов/i)
    await expect(page.locator("[data-login-state='form']")).toBeVisible()
  })

  test("«Почта недоступна»: письмо не отправлено, форма остаётся", async ({ page }) => {
    await page.route(GRAPHQL_ROUTE, async (route) => {
      if (readOperation(route.request().postData()).includes("RequestMagicLink")) {
        await route.fulfill(
          graphqlErrorBody("requestMagicLink", {
            code: "PROVIDER_UNAVAILABLE",
            provider: "mail",
            requestId: "req-stub"
          })
        )
        return
      }
      await route.continue()
    })

    await page.goto("/login")
    await expect(page.locator("[data-login-state='form']")).toBeVisible()
    await requestLinkFrom(page, uniqueEmail("t022-provider"))

    await expect(pageAlert(page)).toContainText(/не удалось отправить/i)
  })

  test("проверка формата и согласия выполняется до отправки", async ({ page }) => {
    await page.goto("/login")
    await expect(page.locator("[data-login-state='form']")).toBeVisible()

    // Согласие не отмечено — кнопка неактивна (login.md §7, предусловие действия).
    await page.getByLabel(/адрес электронной почты/i).fill("reader@example.test")
    await expect(page.getByRole("button", { name: /получить ссылку входа/i })).toBeDisabled()

    await page.getByRole("checkbox").check()
    await page.getByLabel(/адрес электронной почты/i).fill("not-an-address")
    await page.getByRole("button", { name: /получить ссылку входа/i }).click()

    await expect(pageAlert(page)).toContainText(/корректный адрес/i)
  })

  test("«Заблокирован»: для архивированного адреса форма отвечает как обычно", async ({ page }) => {
    const email = uniqueEmail("t022-blocked-login")
    await createArchivedUser({ email, mode: "admin" })

    await page.goto("/login")
    await expect(page.locator("[data-login-state='form']")).toBeVisible()
    await requestLinkFrom(page, email)

    await expect(page.locator("[data-login-state='sent']")).toBeVisible()
    await expect(pageAlert(page)).toHaveCount(0)
  })

  test("«Нет доступа»: с сессией /login отвечает редиректом", async ({ page, request }) => {
    const email = uniqueEmail("t022-session")
    await page.goto("/login")
    await expect(page.locator("[data-login-state='form']")).toBeVisible()
    await requestLinkFrom(page, email)
    await expect(page.locator("[data-login-state='sent']")).toBeVisible()

    const token = await readMagicLinkToken(request, email)
    await page.goto(`/auth/verify?token=${token}`)
    await expect(page).toHaveURL(/\/me(?:\?|$)/)

    await page.goto("/login")
    await expect(page).toHaveURL(/\/me(?:\?|$)/)
  })

  test("и русская, и английская страница входа закрыты от индексации", async ({ page }) => {
    for (const path of ["/login", "/en/login"]) {
      await page.goto(path)
      await expect(page.locator("head meta[name='robots']").first()).toHaveAttribute("content", /noindex/)
    }
  })

  test("«Регистрация» отдельным адресом не существует", async ({ request }) => {
    for (const path of ["/signup", "/register"]) {
      const response = await request.get(path, { maxRedirects: 0 })
      expect(response.status()).toBe(301)
      expect(response.headers().location).toContain("/login")
    }
  })
})

test.describe("страница подтверждения по таблице состояний", () => {
  test.beforeEach(async () => {
    await ensurePublishedLegalVersions()
  })

  test("«Загрузка»: успешный обмен отвечает 302 на кабинет", async ({ page, request }) => {
    const email = uniqueEmail("t022-verify-ok")
    await page.goto("/login")
    await expect(page.locator("[data-login-state='form']")).toBeVisible()
    await requestLinkFrom(page, email)
    await expect(page.locator("[data-login-state='sent']")).toBeVisible()

    const token = await readMagicLinkToken(request, email)
    const response = await request.get(`/auth/verify?token=${token}`, { maxRedirects: 0 })

    expect(response.status()).toBe(302)
    expect(response.headers().location).toContain("/me")
  })

  test("«Пусто»: без токена — 302 на страницу входа", async ({ request }) => {
    const response = await request.get("/auth/verify", { maxRedirects: 0 })

    expect(response.status()).toBe(302)
    expect(response.headers().location).toContain("/login")
  })

  test("«Не найдено»: неизвестная ссылка отвечает 200 и предлагает новую", async ({ page }) => {
    const response = await page.goto(`/auth/verify?token=${"a".repeat(64)}`)

    expect(response?.status()).toBe(200)
    await expect(page.locator("[data-verify-state='invalid']")).toBeVisible()
    await expect(page.getByRole("link", { name: /запросить новую ссылку/i })).toBeVisible()
  })

  test("«Заблокирован» администратором: сессии нет, предлагается оспаривание", async ({ page, request }) => {
    const email = uniqueEmail("t022-verify-blocked")
    await createArchivedUser({ email, mode: "emergency" })

    await page.goto("/login")
    await expect(page.locator("[data-login-state='form']")).toBeVisible()
    await requestLinkFrom(page, email)
    await expect(page.locator("[data-login-state='sent']")).toBeVisible()

    const token = await readMagicLinkToken(request, email)
    await page.goto(`/auth/verify?token=${token}`)

    await expect(page.locator("[data-verify-state='blocked']")).toBeVisible()
    await expect(page.getByRole("link", { name: /оспорить/i })).toHaveAttribute("href", `/auth/appeal?token=${token}`)

    const sessions = await withPrisma((prisma) => prisma.session.findMany({ where: { user: { email } } }))
    expect(sessions).toHaveLength(0)
  })

  test("«Примите новые условия»: устаревшее согласие завершается принятием", async ({ page, request }) => {
    // Английская локаль: версии ru-страницы входа остаются нетронутыми для других сценариев.
    await ensurePublishedLegalVersions("en", { termsVersion: 2, privacyVersion: 1 })
    const email = uniqueEmail("t022-consent")

    await withPrisma(async (prisma) => {
      // Повторное согласие требует существенной редакции (T-101, ADR-0028 п. 2).
      await prisma.legalText.update({
        where: { kind_locale_version: { kind: "terms", locale: "en", version: 2 } },
        data: { isMaterial: true }
      })

      const handle = `t022-consent-${Math.random().toString(16).slice(2, 10)}`
      await prisma.handleHistory.create({ data: { handle } })
      const user = await prisma.user.create({ data: { email, handle, locale: "en", name: "T022 consent" } })
      await prisma.handleHistory.update({ where: { handle }, data: { userId: user.id } })

      // Принята прежняя версия оферты и действующая версия политики.
      const outdatedTerms = await prisma.legalText.upsert({
        where: { kind_locale_version: { kind: "terms", locale: "en", version: 1 } },
        update: { status: "previous" },
        create: {
          kind: "terms",
          locale: "en",
          version: 1,
          status: "previous",
          body: "E2E terms v1",
          summaryOfChanges: "e2e fixture",
          publishedAt: new Date()
        }
      })
      const currentPrivacy = await prisma.legalText.findFirstOrThrow({
        where: { kind: "privacy", locale: "en", version: 1 }
      })
      await prisma.userLegalConsent.createMany({
        data: [
          { userId: user.id, legalTextId: outdatedTerms.id },
          { userId: user.id, legalTextId: currentPrivacy.id }
        ]
      })
    })

    await page.goto("/login")
    await expect(page.locator("[data-login-state='form']")).toBeVisible()
    await requestLinkFrom(page, email)
    await expect(page.locator("[data-login-state='sent']")).toBeVisible()

    const token = await readMagicLinkToken(request, email)
    await page.goto(`/auth/verify?token=${token}`)

    await expect(page.locator("[data-verify-state='consent']")).toBeVisible()
    await page.getByRole("button", { name: /accept and continue|принять и продолжить/i }).click()

    await expect(page).toHaveURL(/\/me(?:\?|$)/)
    const consents = await withPrisma((prisma) =>
      prisma.userLegalConsent.findMany({ where: { user: { email } }, include: { legalText: true } })
    )
    expect(consents.some(({ legalText }) => legalText.kind === "terms" && legalText.version === 2)).toBe(true)
  })

  test("страница подтверждения закрыта от индексации и не передаёт Referer", async ({ page }) => {
    await page.goto(`/auth/verify?token=${"b".repeat(64)}`)

    await expect(page.locator("head meta[name='robots']").first()).toHaveAttribute("content", /noindex/)
    await expect(page.locator("head meta[name='referrer']").first()).toHaveAttribute("content", "no-referrer")
  })
})
