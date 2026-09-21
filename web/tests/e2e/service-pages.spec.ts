import { expect, test, type Page } from "@playwright/test"

// Строки состояний §8 трёх служебных спецификаций (`not-found.md`, `error.md`, `offline.md`)
// и решение журнала §28.4: код запроса показывается только при техническом сбое.

const REQUEST_ID = "t058-request-id"

/** Отказ API с кодом запроса: страница материала превращает его в 500 (`error.md` §3). */
const internalError = {
  errors: [{ message: "internal", extensions: { code: "INTERNAL_ERROR", requestId: REQUEST_ID } }]
}

/**
 * Переход без перезагрузки: моки `page.route` ловят только браузерные запросы, а SSR ходит
 * в API мимо браузера. До гидратации роутер ещё не слушает popstate, поэтому переход
 * повторяется, пока адрес не закрепится.
 */
const navigateInPage = async (page: Page, path: string) => {
  await expect(async () => {
    await page.evaluate((target) => {
      window.history.pushState({}, "", target)
      window.dispatchEvent(new PopStateEvent("popstate"))
    }, path)
    await expect(page).toHaveURL(path, { timeout: 1000 })
  }).toPass()
}

test.describe("страница 404", () => {
  test("отвечает 404, объясняет адрес и не показывает код запроса", async ({ page }) => {
    const response = await page.goto("/a/b/c/d")

    expect(response?.status()).toBe(404)
    await expect(page.getByTestId("not-found")).toContainText("404")
    await expect(page).toHaveTitle(/Страница не найдена/)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/)

    // Зона «куда пойти» (§5 зона 4) и ненавязчивая кнопка обращения (§5 зона 5, журнал §20.15).
    const whereTo = page.getByTestId("not-found-links")
    await expect(whereTo.getByRole("link", { name: "Рубрики", exact: true })).toBeVisible()
    await expect(whereTo.getByRole("link", { name: "Авторы", exact: true })).toBeVisible()
    await expect(page.getByTestId("report-link-toggle")).toBeVisible()

    // Журнал §28.4: обычное пользовательское состояние обходится без кода запроса.
    await expect(page.getByTestId("copy-field-value")).toHaveCount(0)
    await expect(page.getByText("Код запроса")).toHaveCount(0)
  })

  test("зона подборки показывает не больше трёх карточек", async ({ page }) => {
    await page.goto("/a/b/c/d")

    const cards = page.locator('[data-testid="not-found-cards"] article')
    expect(await cards.count()).toBeLessThanOrEqual(3)
  })

  test("обращение о битой ссылке отправляется и благодарит", async ({ page }) => {
    await page.goto("/a/b/c/d")
    await page.waitForLoadState("networkidle")

    let sent: Record<string, unknown> | null = null
    await page.route("**/api/graphql", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}")
      if (!String(body.query ?? "").includes("CreateBrokenLinkReport")) return route.continue()
      sent = body.variables
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { createSupportRequest: { ok: true } } })
      })
    })

    await page.getByTestId("report-link-toggle").click()
    await page.getByTestId("report-link-message").fill("Ссылка пришла из рассылки")
    await page.getByTestId("report-link-submit").click()

    await expect(page.getByTestId("report-link-sent")).toBeVisible()
    // В обращение уходит путь без query (`not-found.md` §4).
    expect(sent).toMatchObject({ topic: "broken_link", path: "/a/b/c/d" })
  })

  test("превышенный лимит обращений показывает свою строку", async ({ page }) => {
    await page.goto("/a/b/c/d")
    await page.waitForLoadState("networkidle")

    await page.route("**/api/graphql", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}")
      if (!String(body.query ?? "").includes("CreateBrokenLinkReport")) return route.continue()
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ errors: [{ message: "limit", extensions: { code: "RATE_LIMITED" } }] })
      })
    })

    await page.getByTestId("report-link-toggle").click()
    await page.getByTestId("report-link-submit").click()

    await expect(page.getByTestId("report-link-limited")).toBeVisible()
  })
})

test.describe("страница 500", () => {
  test("показывает код запроса, копирование и письмо в редакцию", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    await page.route("**/api/graphql", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(internalError) })
    })

    await navigateInPage(page, "/culture/t058-broken")

    await expect(page.getByTestId("server-error")).toContainText("500")
    await expect(page.getByTestId("copy-field-value")).toHaveText(REQUEST_ID)
    await expect(page.getByTestId("server-error-retry")).toBeVisible()
    await expect(page.getByTestId("server-error-contact")).toHaveAttribute("href", `/contact?requestId=${REQUEST_ID}`)
    // Публичной страницы статуса сервиса нет (журнал §20.17).
    await expect(page.getByText(/повторяется дольше нескольких минут/)).toBeVisible()
  })

  test("копирование кода запроса подтверждается", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    await page.route("**/api/graphql", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(internalError) })
    })

    await navigateInPage(page, "/culture/t058-broken")
    await page.getByTestId("copy-field-button").click()

    await expect(page.getByTestId("copy-field-copied")).toBeVisible()
  })
})

test.describe("офлайн-страница", () => {
  test("сообщает об отсутствии сети и предлагает повторить", async ({ page }) => {
    await page.goto("/offline")

    await expect(page).toHaveTitle(/Нет соединения/)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/)
    await expect(page.getByTestId("offline-description")).toHaveText(/сеть вернётся/)
    await expect(page.getByTestId("offline-retry")).toBeVisible()
    // Вход и «Писать» офлайн не выполнятся (`offline.md` §6).
    await expect(page.getByRole("link", { name: "Войти", exact: true })).toHaveCount(0)
  })

  test("пустой кеш объясняет, что сохранится позже", async ({ page }) => {
    await page.goto("/offline")
    await page.evaluate(async () => {
      for (const name of await caches.keys()) await caches.delete(name)
    })
    await page.reload()

    await expect(page.getByTestId("cached-list-empty")).toBeVisible()
  })

  test("сохранённые страницы показываются списком", async ({ page }) => {
    await page.goto("/offline")
    await page.evaluate(async () => {
      const cache = await caches.open("t058-pages")
      await cache.put(
        new Request("/culture/t058-saved"),
        new Response("<html><head><title>Эссе о городе</title></head><body></body></html>", {
          headers: { "content-type": "text/html; charset=utf-8", date: "Sat, 19 Sep 2026 08:00:00 GMT" }
        })
      )
    })
    await page.reload()

    await expect(page.getByTestId("cached-list").getByRole("link", { name: "Эссе о городе" })).toHaveAttribute(
      "href",
      "/culture/t058-saved"
    )

    await page.evaluate(() => caches.delete("t058-pages"))
  })

  test("запрошенный адрес вне кеша получает свою строку", async ({ page }) => {
    await page.goto("/offline?from=/culture/t058-missing")

    await expect(page.getByTestId("offline-description")).toHaveText(/не сохранена/)
  })

  test("без Cache Storage список не показывается", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "caches", { configurable: true, get: () => undefined })
    })
    await page.goto("/offline")

    await expect(page.getByTestId("offline-storage-unavailable")).toBeVisible()
    await expect(page.getByTestId("cached-list")).toHaveCount(0)
  })

  test("повтор показывает индикатор и уводит на запрошенный адрес", async ({ page }) => {
    // Ответ задерживается, иначе переход завершается раньше, чем индикатор станет виден.
    await page.route("**/culture/t058-retry", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await route.continue()
    })
    await page.goto("/offline?from=/culture/t058-retry")

    await page.getByTestId("offline-retry").click()

    await expect(page.getByTestId("offline-retrying")).toBeVisible()
    await expect(page).toHaveURL(/\/culture\/t058-retry$/)
  })
})
