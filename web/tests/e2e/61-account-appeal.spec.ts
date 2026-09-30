import { expect, test, type Page, type Route } from "./helpers/test"
import { navigateOnClient } from "./helpers/hydration"

const GRAPHQL_ROUTE = "**/api/graphql"

type AppealStatus = "none" | "submitted" | "restored" | "confirmed"

const operation = (route: Route) => {
  try {
    return String((JSON.parse(route.request().postData() ?? "{}") as { query?: unknown }).query ?? "")
  } catch {
    return ""
  }
}

const view = (status: AppealStatus) => ({
  locale: "ru",
  archivedAt: "2026-09-20T00:00:00.000Z",
  reasonCategory: "rules_violation",
  explanation: "Аккаунт ограничен за нарушение правил публикации.",
  staffMessage: "Можно пояснить обстоятельства в форме ниже.",
  plan: { tier: "standard", until: "2026-12-01T00:00:00.000Z" },
  appeal: {
    id: status === "none" ? null : "appeal-1",
    status,
    submittedAt: status === "none" ? null : "2026-09-21T00:00:00.000Z",
    decidedAt: status === "restored" || status === "confirmed" ? "2026-09-22T00:00:00.000Z" : null
  },
  canSubmit: status === "none"
})

const openWithMock = async (page: Page, handler: (route: Route) => Promise<void>, token = "t061-browser-token") => {
  await page.goto("/")
  await page.route(GRAPHQL_ROUTE, async (route) => {
    if (!operation(route).includes("AccountAppeal")) return route.continue()
    await handler(route)
  })
  await navigateOnClient(page, `/auth/appeal?token=${token}`)
}

const fulfillView = (status: AppealStatus) => (route: Route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { accountAppeal: view(status) } })
  })

const fulfillError =
  (code: string, extra: Record<string, unknown> = {}) =>
  (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { accountAppeal: null },
        errors: [{ message: "stubbed", extensions: { code, ...extra } }]
      })
    })

test.describe("страница оспаривания блокировки", () => {
  test("«Загрузка» сменяется формой после ответа API", async ({ page }) => {
    await page.goto("/")
    await page.route(GRAPHQL_ROUTE, async (route) => {
      if (!operation(route).includes("AccountAppeal")) return route.continue()
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      await fulfillView("none")(route)
    })

    const navigation = navigateOnClient(page, "/auth/appeal?token=t061-loading")
    await expect(page.locator('[data-appeal-state="loading"]')).toBeVisible()
    await navigation
    await expect(page.locator('[data-appeal-state="none"]')).toBeVisible()
  })

  for (const state of ["not_found", "forbidden"] as const) {
    test(`ошибка ${state} имеет отдельное состояние`, async ({ page }) => {
      await openWithMock(page, fulfillError(state === "not_found" ? "NOT_FOUND" : "FORBIDDEN"))
      await expect(page.locator(`[data-appeal-state="${state}"]`)).toBeVisible()
    })
  }

  test("ограничение частоты показывает срок повтора", async ({ page }) => {
    await openWithMock(page, fulfillError("RATE_LIMITED", { retryAfter: 600 }))
    const state = page.locator('[data-appeal-state="rate_limited"]')
    await expect(state).toBeVisible()
    await expect(state).toContainText("10")
  })

  test("техническая ошибка показывает код запроса", async ({ page }) => {
    await openWithMock(page, fulfillError("INTERNAL_ERROR", { requestId: "t061-request-id" }))
    const state = page.locator('[data-appeal-state="error"]')
    await expect(state).toBeVisible()
    await expect(state).toContainText("t061-request-id")
  })

  for (const status of ["none", "submitted", "restored", "confirmed"] as const) {
    test(`состояние обращения ${status} воспроизводится отдельно`, async ({ page }) => {
      await openWithMock(page, fulfillView(status), `t061-${status}`)
      await expect(page.locator(`[data-appeal-state="${status}"]`)).toBeVisible()
      await expect(page.locator("[data-appeal-reason]")).toContainText("нарушение правил публикации")
      await expect(page.locator("[data-appeal-plan]")).toBeVisible()
    })
  }

  test("форма отправляет обращение и переходит в submitted", async ({ page }) => {
    await page.goto("/")
    await page.route(GRAPHQL_ROUTE, async (route) => {
      const query = operation(route)
      if (query.includes("SubmitAccountAppeal")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              submitAccountAppeal: {
                id: "appeal-1",
                status: "submitted",
                submittedAt: "2026-09-21T00:00:00.000Z",
                decidedAt: null
              }
            }
          })
        })
        return
      }
      if (query.includes("AccountAppeal")) return fulfillView("none")(route)
      await route.continue()
    })
    await navigateOnClient(page, "/auth/appeal?token=t061-submit")

    await page.locator("#appeal-message").fill("Прошу повторно проверить обстоятельства блокировки аккаунта.")
    await page.locator("[data-appeal-form] button[type='submit']").click()

    await expect(page.locator('[data-appeal-state="submitted"]')).toBeVisible()
  })
})
