import { expect, test } from "@playwright/test"

test.describe("admin grants page", () => {
  test("shows all grant status rows — queued, active, ended, revoked", async ({ page }) => {
    await page.goto("/admin/grants")

    await expect(page.getByText(/в очереди/i)).toBeVisible()
    await expect(page.getByText(/активна/i).first()).toBeVisible()
    await expect(page.getByText(/завершена/i)).toBeVisible()
    await expect(page.getByText(/отозвана/i)).toBeVisible()
  })

  test("shows indefinite grant (бессрочно) when endsAt is null", async ({ page }) => {
    await page.goto("/admin/grants")

    await expect(page.getByText(/бессрочно/i).first()).toBeVisible()
  })

  test("opens detail panel on row click", async ({ page }) => {
    await page.goto("/admin/grants")

    await page.getByText("Александр Иванов").first().click()
    await expect(page.getByText(/тестирование pro-функций/i)).toBeVisible()
  })

  test("grant form opens and validates required fields — AC-1", async ({ page }) => {
    await page.goto("/admin/grants")

    await page.getByRole("button", { name: /выдать план/i }).click()

    const submitBtn = page.getByRole("button", { name: /выдать план/i }).last()
    await expect(submitBtn).toBeDisabled()

    await page.getByPlaceholder(/user-handle/i).fill("test-user")
    await expect(submitBtn).toBeDisabled()

    await page.getByPlaceholder(/причину выдачи/i).fill("Тестовая причина")
    await expect(submitBtn).toBeEnabled()
  })

  test("indefinite grant — endsAt empty, submit succeeds — AC-1", async ({ page }) => {
    await page.goto("/admin/grants")

    await page.getByRole("button", { name: /выдать план/i }).click()
    await page.getByPlaceholder(/user-handle/i).fill("new-user")
    await page.getByPlaceholder(/причину выдачи/i).fill("Тест бессрочной выдачи")

    const endDateInput = page.getByLabel(/конец/i)
    await expect(endDateInput).toHaveValue("")

    await page
      .getByRole("button", { name: /выдать план/i })
      .last()
      .click()
    await expect(page.getByPlaceholder(/user-handle/i)).not.toBeVisible()

    await expect(page.getByText("new-user")).toBeVisible()
  })
})

test.describe("admin subscriptions page — first launch mode", () => {
  test("shows first-launch banner about paid subscriptions phase", async ({ page }) => {
    await page.goto("/admin/subscriptions")

    await expect(page.getByText(/платные подписки.*отдельный этап/i)).toBeVisible()
  })

  test("shows grants list — all state rows visible — AC-2", async ({ page }) => {
    await page.goto("/admin/subscriptions")

    await expect(page.getByText(/в очереди/i)).toBeVisible()
    await expect(page.getByText(/активна/i).first()).toBeVisible()
    await expect(page.getByText(/завершена/i)).toBeVisible()
    await expect(page.getByText(/отозвана/i)).toBeVisible()
  })

  test("link to grants page is present in detail panel", async ({ page }) => {
    await page.goto("/admin/subscriptions")

    await page.getByText("Александр Иванов").first().click()
    await expect(page.getByRole("link", { name: /управление выдачами/i })).toBeVisible()
  })
})
