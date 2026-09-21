import { expect, test, type Page, type Route } from "@playwright/test"
import { setSessionCookie, uniqueEmail, withPrisma } from "./helpers/auth-fixtures"

/**
 * T-059: «О проекте» и «Письмо в редакцию» (`docs/spec/20-public/about.md`, `contact.md`).
 * Критерий 1 — обращение сохраняется и несёт `requestId` — проверяется на живой базе. Критерий 2 —
 * строки состояний §8 обеих спецификаций. Строки, которые зависят от отказа сервера (лимит, сбой
 * сохранения, сбой текста), снимаются подстановкой ответа `/api/graphql`: корзина `contact.ip` —
 * 3 обращения в час на адрес (`rate-limits.md` §2 п. 4), поэтому живых отправок здесь две.
 */

const MESSAGE = "Здравствуйте! После оплаты страница показала ошибку, подскажите, что делать."

/** Переход без перезагрузки: моки `page.route` ловят только браузерные запросы, SSR ходит мимо. */
const navigateInPage = async (page: Page, path: string) => {
  await expect(async () => {
    await page.evaluate((target) => {
      window.history.pushState({}, "", target)
      window.dispatchEvent(new PopStateEvent("popstate"))
    }, path)
    await expect(page).toHaveURL(path, { timeout: 1000 })
  }).toPass()
}

const fulfillOperation = (page: Page, operation: string, body: unknown) =>
  page.route("**/api/graphql", async (route: Route) => {
    const payload = JSON.parse(route.request().postData() ?? "{}")
    if (!String(payload.query ?? "").includes(operation)) return route.continue()
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
  })

const fillGuestForm = async (page: Page, email: string) => {
  await page.getByTestId("contact-email").fill(email)
  await page.getByTestId("contact-message").fill(MESSAGE)
  await page.getByTestId("contact-consent").check()
}

test.describe("«Письмо в редакцию»", () => {
  test("гость со страницы 500: обращение сохраняется с requestId и получает номер", async ({ page }) => {
    const email = uniqueEmail("t059-guest")
    const response = await page.goto("/contact?requestId=t059-request-id")

    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle(/Написать в редакцию/)
    // Адрес с параметрами не индексируется, канонический — без них (§10).
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/contact$/)
    await expect(page.getByTestId("contact-request-id")).toContainText("t059-request-id")
    await page.waitForLoadState("networkidle")

    await fillGuestForm(page, email)
    await page.getByTestId("contact-submit").click()

    await expect(page.getByTestId("contact-sent")).toContainText(/Обращение №\d+ принято/)
    await expect(page.getByTestId("contact-sent")).toContainText(email)

    const saved = await withPrisma((prisma) => prisma.supportRequest.findMany({ where: { email } }))
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ topic: "general", requestId: "t059-request-id", userId: null, message: MESSAGE })
    await expect(page.getByTestId("contact-sent")).toContainText(`№${saved[0]!.ticketNo}`)
  })

  test("аккаунт пишет с адреса сессии; тема «возврат» ведёт в кабинет", async ({ page }) => {
    const email = uniqueEmail("t059-account")
    const userId = await withPrisma(async (prisma) => {
      const handle = `t059-${Math.random().toString(16).slice(2, 10)}`
      await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
      const user = await prisma.user.create({ data: { email, handle, name: "T059 account" } })
      await prisma.handleHistory.update({ where: { handle }, data: { userId: user.id } })
      return user.id
    })
    await setSessionCookie(page, userId)

    await page.goto("/contact?topic=refund")
    await expect(page.getByTestId("contact-account-email")).toContainText(email)
    await expect(page.getByTestId("contact-email")).toHaveCount(0)
    await expect(page.getByTestId("contact-consent")).toHaveCount(0)
    await expect(page.getByTestId("contact-refund-link")).toHaveAttribute("href", "/me/subscription")

    await page.getByTestId("contact-message").fill(MESSAGE)
    await page.getByTestId("contact-submit").click()
    await expect(page.getByTestId("contact-sent")).toContainText(email)

    const saved = await withPrisma((prisma) => prisma.supportRequest.findMany({ where: { userId } }))
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ topic: "refund", email, requestId: null })
  })

  test("страница 404 предзаполняет тему и путь, неизвестная тема — «другое»", async ({ page }) => {
    await page.goto("/contact?topic=broken_link&path=%2Fa%2Fb%3Fx%3D1")
    await expect(page.getByTestId("contact-topic")).toHaveValue("broken_link")
    await expect(page.getByTestId("contact-path-line")).toContainText("/a/b")
    await page.getByTestId("contact-path-edit").click()
    await expect(page.getByTestId("contact-path")).toHaveValue("/a/b")

    await page.goto("/contact?topic=privacy")
    await expect(page.getByTestId("contact-topic")).toHaveValue("other")
  })

  test("ошибки полей: пустая форма не уходит на сервер", async ({ page }) => {
    await page.goto("/contact")
    await page.waitForLoadState("networkidle")
    let sent = false
    page.on("request", (request) => {
      if (request.url().includes("/api/graphql") && (request.postData() ?? "").includes("CreateSupportRequest")) {
        sent = true
      }
    })

    await page.getByTestId("contact-submit").click()

    await expect(page.getByTestId("contact-email-error")).toBeVisible()
    await expect(page.getByTestId("contact-message-error")).toBeVisible()
    await expect(page.getByTestId("contact-consent-error")).toBeVisible()
    expect(sent).toBe(false)
  })

  test("строка «Ограничение»: лимит показывает таймер и блокирует отправку", async ({ page }) => {
    await page.goto("/contact")
    await page.waitForLoadState("networkidle")
    await fulfillOperation(page, "CreateSupportRequest", {
      errors: [{ message: "limit", extensions: { code: "RATE_LIMITED", retryAfter: 125 } }]
    })

    await fillGuestForm(page, "limited@example.test")
    await page.getByTestId("contact-submit").click()

    await expect(page.getByTestId("contact-limited")).toContainText(/2:0\d/)
    await expect(page.getByTestId("contact-submit")).toBeDisabled()
    // Журнал §28.4: на лимите код запроса не показывается.
    await expect(page.getByText("Код запроса")).toHaveCount(0)
  })

  test("строка «Ошибка данных»: сбой сохранения — ErrorState с кодом, текст остаётся", async ({ page }) => {
    await page.goto("/contact")
    await page.waitForLoadState("networkidle")
    await fulfillOperation(page, "CreateSupportRequest", {
      errors: [{ message: "internal", extensions: { code: "INTERNAL_ERROR", requestId: "t059-save-failed" } }]
    })

    await fillGuestForm(page, "failed@example.test")
    await page.getByTestId("contact-submit").click()

    await expect(page.getByTestId("contact-error")).toContainText("t059-save-failed")
    await expect(page.getByTestId("contact-message")).toHaveValue(MESSAGE)
  })

  test("строка «Заблокирован»: архивированный аккаунт видит обычную форму гостя", async ({ page }) => {
    // Сессия читается только в браузере, поэтому подстановка ответа успевает до первого запроса.
    await fulfillOperation(page, "GetContactViewer", {
      data: { me: { id: "archived-1", email: "archived@example.test", isArchived: true } }
    })
    await page.goto("/contact?topic=restore")
    await page.waitForLoadState("networkidle")

    await expect(page.getByTestId("contact-email")).toBeVisible()
    await expect(page.getByTestId("contact-consent")).toBeVisible()
    await expect(page.getByTestId("contact-topic")).toHaveValue("restore")
  })

  test("английская версия и мобильная раскладка", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const response = await page.goto("/en/contact")

    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle(/Write to the editors/)
    const submit = await page.getByTestId("contact-submit").boundingBox()
    const form = await page.getByTestId("contact-form").boundingBox()
    // На `< md` кнопка во всю ширину формы (§9).
    expect(Math.round(submit!.width)).toBe(Math.round(form!.width))
  })
})

test.describe("«О проекте»", () => {
  /*
   * Текст вида `about` параллельно публикует `admin-legal.spec.ts`, поэтому база здесь не
   * меняется: серверный рендер проверяется на любом её состоянии, а строки §8 — клиентским
   * переходом с подстановкой ответа `GetAboutPage`.
   */
  const aboutText = (overrides: Record<string, unknown> = {}) => ({
    kind: "about",
    locale: "ru",
    requestedLocale: "ru",
    isFallbackLocale: false,
    version: 3,
    publishedAt: "2026-09-20T00:00:00.000Z",
    html: '<h2 id="status">Статус проекта</h2><p>Проект развивается: T-059.</p>',
    availableLocales: ["ru"],
    ...overrides
  })
  const section = (slug: string, articleCount: number) => ({
    slug,
    name: `Рубрика ${slug}`,
    description: null,
    articleCount
  })

  const openWithAbout = async (page: Page, body: unknown, path = "/about") => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await fulfillOperation(page, "GetAboutPage", body)
    await navigateInPage(page, path)
  }

  test("серверный рендер: статические зоны, призыв и SEO", async ({ page }) => {
    const response = await page.goto("/about")

    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle(/О проекте/)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index/)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/about$/)
    await expect(page.locator('script[type="application/ld+json"]')).toContainText("AboutPage")
    await expect(page.getByTestId("about-lead")).toContainText("чтение бесплатно")
    await expect(page.locator('[data-testid^="about-column-"]')).toHaveCount(3)
    await expect(page.locator("[data-about-state]")).toHaveAttribute("data-about-state", /ready|unpublished/)
    await expect(page.getByTestId("about-cta-pricing")).toHaveAttribute("href", "/pricing")
    await expect(page.getByTestId("about-cta-contact")).toHaveAttribute("href", "/contact")
    // Гость не видит ссылку редактирования (§2).
    await expect(page.getByTestId("about-edit")).toHaveCount(0)
  })

  test("текст опубликован: текст владельца и только непустые рубрики", async ({ page }) => {
    await openWithAbout(page, {
      data: { staticText: aboutText(), sectionCatalog: [section("culture", 4), section("empty", 0)] }
    })

    await expect(page.getByTestId("about-body")).toContainText("Проект развивается: T-059.")
    await expect(page.getByTestId("about-version")).toContainText("3")
    await expect(page.locator('[data-testid="about-sections"] li')).toHaveCount(1)
    await expect(page.getByTestId("about-sections").getByRole("link", { name: "Рубрика culture" })).toBeVisible()
  })

  test("строка «Пусто»: текст другой локали с пометкой, пустые рубрики скрыты", async ({ page }) => {
    await openWithAbout(page, {
      data: {
        staticText: aboutText({ locale: "ru", requestedLocale: "en", isFallbackLocale: true }),
        sectionCatalog: []
      }
    })

    await expect(page.getByTestId("about-fallback")).toBeVisible()
    await expect(page.getByTestId("about-body")).toContainText("Проект развивается")
    await expect(page.getByTestId("about-sections")).toHaveCount(0)
  })

  test("текст не опубликован нигде: состояние «готовится», статическая часть на месте", async ({ page }) => {
    await openWithAbout(page, { data: { staticText: null, sectionCatalog: [] } })

    await expect(page.getByTestId("about-unpublished")).toBeVisible()
    await expect(page.getByTestId("about-lead")).toBeVisible()
    await expect(page.getByTestId("about-cta")).toBeVisible()
  })

  test("строки «Загрузка» и «Ошибка данных» при клиентском переходе", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    let release: () => void = () => undefined
    const released = new Promise<void>((resolve) => (release = resolve))
    await page.route("**/api/graphql", async (route) => {
      const payload = JSON.parse(route.request().postData() ?? "{}")
      if (!String(payload.query ?? "").includes("GetAboutPage")) return route.continue()
      await released
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          errors: [{ message: "internal", extensions: { code: "INTERNAL_ERROR", requestId: "t059-about-failed" } }]
        })
      })
    })

    await navigateInPage(page, "/about")
    await expect(page.getByTestId("about-skeleton")).toBeVisible()

    release()
    await expect(page.getByTestId("about-error")).toBeVisible()
    await expect(page.getByTestId("about-lead")).toBeVisible()
    await expect(page.getByTestId("about-cta")).toBeVisible()
  })

  test("owner видит ссылку «редактировать текст» и подсказку опубликовать", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await fulfillOperation(page, "GetAboutViewer", { data: { me: { id: "owner-1", role: "owner" } } })
    await fulfillOperation(page, "GetAboutPage", { data: { staticText: null, sectionCatalog: [] } })

    await navigateInPage(page, "/about")

    await expect(page.getByTestId("about-edit")).toHaveAttribute("href", "/admin/legal/about")
    await expect(page.getByTestId("about-owner-hint")).toBeVisible()
  })
})
