import { expect, test, type Page } from "@playwright/test"

const grants = [
  {
    id: "grant-queued",
    userId: "user-queued",
    userName: "Пользователь в очереди",
    userHandle: "queued-user",
    tier: "standard",
    startsAt: "2026-10-01T00:00:00.000Z",
    endsAt: "2026-11-01T00:00:00.000Z",
    grantedByName: "Аналитик",
    reason: "Будущая выдача",
    status: "queued",
    revokedAt: null,
    createdAt: "2026-09-19T00:00:00.000Z"
  },
  {
    id: "grant-active",
    userId: "user-active",
    userName: "Активный пользователь",
    userHandle: "active-user",
    tier: "pro",
    startsAt: "2026-09-01T00:00:00.000Z",
    endsAt: "2026-10-01T00:00:00.000Z",
    grantedByName: "Администратор",
    reason: "Активная выдача",
    status: "active",
    revokedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z"
  },
  {
    id: "grant-ended",
    userId: "user-ended",
    userName: "Завершённый пользователь",
    userHandle: "ended-user",
    tier: "standard",
    startsAt: "2026-07-01T00:00:00.000Z",
    endsAt: "2026-08-01T00:00:00.000Z",
    grantedByName: "Аналитик",
    reason: "Завершённая выдача",
    status: "ended",
    revokedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z"
  },
  {
    id: "grant-revoked",
    userId: "user-revoked",
    userName: "Отозванный пользователь",
    userHandle: "revoked-user",
    tier: "pro",
    startsAt: "2026-08-01T00:00:00.000Z",
    endsAt: "2026-10-01T00:00:00.000Z",
    grantedByName: "Владелец",
    reason: "Отозванная выдача",
    status: "revoked",
    revokedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z"
  }
]

async function mockAdminGrants(page: Page, onGrant?: (input: Record<string, unknown>) => void) {
  await page.route("**/api/graphql", async (route) => {
    const body = route.request().postDataJSON() as {
      query?: string
      variables?: { input?: Record<string, unknown> }
    }
    const query = body.query ?? ""
    let data: Record<string, unknown>

    if (query.includes("GetAdminSummary")) {
      data = { adminSummary: { role: "admin", cards: [] } }
    } else if (query.includes("GetAdminGrants")) {
      data = { adminGrants: grants }
    } else if (query.includes("GrantPlan")) {
      onGrant?.(body.variables?.input ?? {})
      data = { grantPlan: { id: "grant-created" } }
    } else if (query.includes("RevokePlan")) {
      data = { revokePlan: { id: "grant-revoked" } }
    } else {
      return route.continue()
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) })
  })
}

async function navigateToAdminPage(page: Page, path: "/admin/grants" | "/admin/subscriptions") {
  await page.goto("/")
  const grantsResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/graphql") && response.request().postData()?.includes("GetAdminGrants") === true
  )
  // Переход клиентский: моки `page.route` ловят только браузерные запросы, поэтому
  // полная загрузка не подходит. До гидратации роутер ещё не слушает popstate и
  // возвращает адрес на «/», поэтому переход повторяется, пока не закрепится.
  await expect(async () => {
    await page.evaluate((target) => {
      window.history.pushState({}, "", target)
      window.dispatchEvent(new PopStateEvent("popstate"))
    }, path)
    await expect(page).toHaveURL(path, { timeout: 1000 })
  }).toPass()
  await grantsResponse
}

test.describe("admin grants page", () => {
  test("shows all persisted grant states and no first-launch authorship row", async ({ page }) => {
    await mockAdminGrants(page)
    await navigateToAdminPage(page, "/admin/grants")

    await expect(page.locator("tbody").getByText("В очереди", { exact: true })).toBeVisible()
    await expect(page.locator("tbody").getByText("Активна", { exact: true })).toBeVisible()
    await expect(page.locator("tbody").getByText("Завершена", { exact: true })).toBeVisible()
    await expect(page.locator("tbody").getByText("Отозвана", { exact: true })).toBeVisible()
    await expect(page.getByText(/базовое авторство первого запуска/i)).toHaveCount(0)
  })

  test("requires endsAt and sends a finite manual grant", async ({ page }) => {
    let submitted: Record<string, unknown> | null = null
    await mockAdminGrants(page, (input) => {
      submitted = input
    })
    await navigateToAdminPage(page, "/admin/grants")

    await page
      .getByRole("button", { name: /выдать план/i })
      .first()
      .click()
    await page.getByPlaceholder(/user-handle/i).fill("new-user")
    await page.getByLabel(/начало/i).fill("2026-09-20")
    await page.getByPlaceholder(/причину выдачи/i).fill("Редакционная выдача")

    const submit = page.getByRole("button", { name: /выдать план/i }).last()
    await expect(submit).toBeDisabled()
    await page.getByLabel(/конец/i).fill("2026-10-20")
    await expect(submit).toBeEnabled()
    await submit.click()

    expect(submitted).toMatchObject({
      userHandle: "new-user",
      startsAt: "2026-09-20T00:00:00.000Z",
      endsAt: "2026-10-20T00:00:00.000Z",
      reason: "Редакционная выдача"
    })
  })

  test.fixme("TODO T-110: indefinite manual grant remains unavailable", async () => {})
})

test.describe("admin subscriptions page — first launch mode", () => {
  test("shows the separate paid phase note and the same persisted states", async ({ page }) => {
    await mockAdminGrants(page)
    await navigateToAdminPage(page, "/admin/subscriptions")

    await expect(page.getByText(/платные подписки.*отдельный этап/i)).toBeVisible()
    await expect(page.locator("tbody").getByText("В очереди", { exact: true })).toBeVisible()
    await expect(page.locator("tbody").getByText("Активна", { exact: true })).toBeVisible()
    await expect(page.locator("tbody").getByText("Завершена", { exact: true })).toBeVisible()
    await expect(page.locator("tbody").getByText("Отозвана", { exact: true })).toBeVisible()
  })

  test("links a selected grant back to grant management", async ({ page }) => {
    await mockAdminGrants(page)
    await navigateToAdminPage(page, "/admin/subscriptions")

    await page.getByText("Активный пользователь").first().click()
    await expect(page.getByRole("link", { name: /управление выдачами/i })).toHaveAttribute("href", "/admin/grants")
  })
})
