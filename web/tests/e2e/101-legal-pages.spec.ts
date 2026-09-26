import { expect, test, type Page, type Route } from "./helpers/test"
import { ensurePublishedLegalVersions, uniqueEmail, withPrisma } from "./helpers/auth-fixtures"
import { createSessionId, signAccessToken } from "./helpers/session-token"
import { SESSION_ACCESS_COOKIE } from "../../shared/session"

/**
 * T-101: страницы `/legal/terms`, `/legal/privacy`, `/legal/content-rules`, `/legal/license`.
 * AC-2 — строки состояний §8 четырёх спецификаций воспроизводимы на настоящем API и базе.
 *
 * Оферта и политика ПД участвуют во входе, поэтому здесь используются только те их редакции,
 * которые поднимают и другие сценарии (`ensurePublishedLegalVersions`, ru v1): новая редакция
 * этих видов повлияла бы на параллельные сценарии входа. Архив, прежнюю редакцию и откат локали
 * проверяют правила публикации и лицензия — они на вход не влияют.
 *
 * Строки, которые спецификации объявляют неприменимыми («Нет доступа», «Ограничение плана»,
 * «Paywall — зарезервировано»), воспроизводятся как обычная публичная страница с кодом 200.
 */

const LICENSE_V1 = '<h2 id="author-rights">Права автора</h2><p>Лицензия, редакция 1.</p>'
const LICENSE_V2 = [
  '<h2 id="author-rights">Права автора</h2><p>Лицензия, редакция 2.</p>',
  '<h2 id="platform-license">Лицензия платформе</h2><p>Показ и публикация.</p>',
  '<h2 id="export">Экспорт</h2><p>Экспорт доступен всегда.</p>'
].join("")
const RULES_V1 = [
  '<h2 id="rights">Права на текст и изображения</h2><p>Правила, редакция 1.</p>',
  '<h2 id="forbidden">Что нельзя публиковать</h2><p>Запрещённое.</p>',
  '<h2 id="review">Как работает проверка</h2><p>Проверка.</p>'
].join("")

type SeedKind = "license" | "content_rules"

/** Редакции видов, не влияющих на вход: повторный запуск не создаёт дублей. */
const seedVersion = (kind: SeedKind, version: number, status: "published" | "previous", body: string) =>
  withPrisma((prisma) =>
    prisma.legalText.upsert({
      where: { kind_locale_version: { kind, locale: "ru", version } },
      update: { status, body },
      create: {
        kind,
        locale: "ru",
        version,
        status,
        body,
        isMaterial: version > 1,
        summaryOfChanges: `e2e ${kind} v${version}`,
        publishedAt: new Date(Date.UTC(2026, 8, version))
      }
    })
  )

const createAccount = async (prefix: string, options: { archived?: boolean; acceptTerms?: boolean } = {}) =>
  withPrisma(async (prisma) => {
    const handle = `${prefix}-${Math.random().toString(16).slice(2, 10)}`
    await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(prefix),
        handle,
        name: "T101 account",
        ...(options.archived ? { archivedAt: new Date(), archiveMode: "self" as const } : {})
      }
    })
    await prisma.handleHistory.update({ where: { handle }, data: { userId: user.id } })

    let acceptedVersion: number | null = null
    if (options.acceptTerms) {
      const current = await prisma.legalText.findFirstOrThrow({
        where: { kind: "terms", locale: "ru", status: "published" },
        orderBy: { version: "desc" }
      })
      await prisma.userLegalConsent.create({ data: { userId: user.id, legalTextId: current.id } })
      acceptedVersion = current.version
    }

    return { id: user.id, sessionId: await createSessionId(prisma, user.id), acceptedVersion }
  })

const useSession = async (page: Page, account: { id: string; sessionId: string }) => {
  await page.context().addCookies([
    {
      name: SESSION_ACCESS_COOKIE,
      value: signAccessToken(account.id, account.sessionId),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }
  ])
}

/** Подменяет ответ одной операции при клиентском переходе: SSR-запрос так не перехватить. */
const stubOperation = (page: Page, operation: string, handle: (route: Route) => Promise<void>) =>
  page.route("**/api/graphql", async (route) => {
    const body = route.request().postDataJSON() as { query?: string } | null
    if (typeof body?.query === "string" && body.query.includes(operation)) {
      await handle(route)
      return
    }
    await route.fallback()
  })

const stateOf = (page: Page) => page.locator("[data-legal-state]")

test.beforeAll(async () => {
  await ensurePublishedLegalVersions()
  await seedVersion("license", 1, "previous", LICENSE_V1)
  await seedVersion("license", 2, "published", LICENSE_V2)
  await seedVersion("content_rules", 1, "published", RULES_V1)
})

test.describe("страницы юридических текстов: строки состояний §8", () => {
  for (const path of ["/legal/terms", "/legal/privacy", "/legal/content-rules", "/legal/license"]) {
    test(`${path}: гость читает действующую редакцию (строки «Нет доступа», «Ограничение плана», Paywall неприменимы)`, async ({
      page
    }) => {
      const response = await page.goto(path)

      expect(response?.status()).toBe(200)
      await expect(stateOf(page)).toHaveAttribute("data-legal-state", "ready")
      await expect(page.getByTestId("legal-version")).toBeVisible()
      await expect(page.getByTestId("legal-body")).toBeVisible()
      await expect(page.locator("head link[rel='canonical']")).toHaveAttribute("href", new RegExp(`${path}$`))
      await expect(page.locator("head meta[name='robots']").first()).toHaveAttribute("content", /^index/)
    })
  }

  test("оглавление, архив редакций и «что изменилось»", async ({ page }) => {
    await page.goto("/legal/license")

    await expect(page.getByTestId("legal-version")).toContainText("2")
    await expect(page.getByTestId("legal-changes")).toContainText("e2e license v2")
    await expect(page.getByTestId("legal-toc").locator("a[href='#platform-license']").last()).toBeAttached()
    await expect(page.getByTestId("legal-archive").locator("a[href='/legal/license?version=1']")).toBeVisible()
    await expect(page.getByTestId("legal-related-legal-content-rules")).toBeVisible()
  })

  test("прежняя редакция по ?version= — плашка «недействующая» и noindex", async ({ page }) => {
    const response = await page.goto("/legal/license?version=1")

    expect(response?.status()).toBe(200)
    await expect(page.getByTestId("legal-previous")).toBeVisible()
    await expect(page.getByTestId("legal-body")).toContainText("редакция 1")
    await expect(page.locator("head meta[name='robots']").first()).toHaveAttribute("content", /noindex/)

    await page.getByTestId("legal-current-link").click()
    await expect(page).toHaveURL(/\/legal\/license$/)
    await expect(page.getByTestId("legal-body")).toContainText("редакция 2")
  })

  test("«Не найдено»: неизвестная и неверная редакция отвечают 404", async ({ page }) => {
    expect((await page.goto("/legal/license?version=99"))?.status()).toBe(404)
    expect((await page.goto("/legal/terms?version=abc"))?.status()).toBe(404)
  })

  test("«Не найдено»: неизвестный якорь правил открывает редакцию сверху с кодом 200", async ({ page }) => {
    const known = await page.goto("/legal/content-rules#forbidden")
    expect(known?.status()).toBe(200)
    await expect(page.locator("#forbidden")).toBeInViewport()

    // Смена только якоря — переход внутри документа без ответа; нужна новая загрузка страницы.
    await page.goto("about:blank")
    const unknown = await page.goto("/legal/content-rules#no-such-section")
    expect(unknown?.status()).toBe(200)
    await expect(page.getByRole("heading", { level: 1 })).toBeInViewport()
  })

  test("«Пусто»: текст локали не опубликован — другая локаль с пометкой", async ({ page }) => {
    const response = await page.goto("/en/legal/license")

    expect(response?.status()).toBe(200)
    await expect(page.getByTestId("legal-fallback")).toBeVisible()
    await expect(page.getByTestId("legal-body")).toContainText("редакция 2")
  })

  test("«Загрузка»: клиентский переход показывает скелет текста", async ({ page }) => {
    await page.goto("/legal/license")
    await stubOperation(page, "GetLegalText", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      await route.fallback()
    })

    await page.getByTestId("legal-related-legal-content-rules").click()

    await expect(page.getByTestId("legal-skeleton")).toBeVisible()
    await expect(stateOf(page)).toHaveAttribute("data-legal-state", "loading")
    await expect(stateOf(page)).toHaveAttribute("data-legal-state", "ready")
    await expect(page.locator("#rights")).toBeVisible()
  })

  test("«Ошибка данных»: отказ API показывает ErrorState с кодом запроса", async ({ page }) => {
    await page.goto("/legal/license")
    await stubOperation(page, "GetLegalText", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: null,
          errors: [{ message: "INTERNAL_ERROR", extensions: { code: "INTERNAL_ERROR", requestId: "e2e-t101" } }]
        })
      })
    )

    await page.getByTestId("legal-related-legal-content-rules").click()

    await expect(stateOf(page)).toHaveAttribute("data-legal-state", "error")
    await expect(page.getByTestId("legal-error")).toContainText("e2e-t101")
  })

  test("аккаунт видит принятую редакцию оферты и ссылки «ваши данные» в политике", async ({ page }) => {
    const account = await createAccount("t101-reader", { acceptTerms: true })
    await useSession(page, account)

    await page.goto("/legal/terms")
    await expect(page.getByTestId("legal-consent")).toContainText(String(account.acceptedVersion))

    await page.goto("/legal/privacy")
    await expect(page.getByTestId("legal-your-data")).toBeVisible()
    await expect(page.getByTestId("legal-your-data-export")).toHaveAttribute("href", "/me/export")
    await expect(page.getByTestId("legal-your-data-delete")).toBeVisible()
  })

  test("«Заблокирован»: архивированный аккаунт читает как гость", async ({ page }) => {
    const account = await createAccount("t101-archived", { archived: true })
    await useSession(page, account)

    const response = await page.goto("/legal/privacy")

    expect(response?.status()).toBe(200)
    await expect(stateOf(page)).toHaveAttribute("data-legal-state", "ready")
    await expect(page.getByTestId("legal-your-data-contact")).toBeVisible()
    await expect(page.getByTestId("legal-your-data-export")).toHaveCount(0)
    await expect(page.getByTestId("legal-consent")).toHaveCount(0)
  })

  test("гость не видит зон аккаунта", async ({ page }) => {
    await page.goto("/legal/privacy")

    await expect(stateOf(page)).toHaveAttribute("data-legal-state", "ready")
    await expect(page.getByTestId("legal-your-data")).toHaveCount(0)
    await expect(page.getByTestId("legal-consent")).toHaveCount(0)
  })
})

test.describe("лицензия и печать", () => {
  test("лицензия содержит запрет обучения ИИ и блок «коротко»", async ({ page }) => {
    await page.goto("/legal/license#ai-training")

    const section = page.locator("#ai-training")
    await expect(section).toBeVisible()
    await expect(section).toContainText(/обучения моделей искусственного интеллекта запрещено/)
    await expect(page.getByTestId("legal-license-summary").locator("section")).toHaveCount(3)
  })

  test("печатная версия — без шапки, футера, оглавления и кнопок", async ({ page }) => {
    await page.goto("/legal/license")
    await page.emulateMedia({ media: "print" })

    await expect(page.getByTestId("legal-body")).toBeVisible()
    await expect(page.locator("header").first()).toBeHidden()
    await expect(page.locator("footer")).toBeHidden()
    await expect(page.getByTestId("legal-print")).toBeHidden()
    await expect(page.getByTestId("legal-toc")).toBeHidden()
  })
})
