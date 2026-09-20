import { expect, test } from "@playwright/test"
import { authenticateAdminPage } from "./helpers/admin-auth"
import { authenticateSessionCookie, uniqueEmail } from "./helpers/auth-fixtures"

test("cabinet page /me has noindex meta tag", async ({ page }) => {
  // Без сессии кабинет уводит на вход (docs/spec/20-public/login.md §3).
  await authenticateSessionCookie(page, uniqueEmail("t022-noindex"))
  await page.goto("/me")

  await expect(page).toHaveURL(/\/me$/)

  const robotsMeta = page.locator('meta[name="robots"]')
  await expect(robotsMeta).toHaveAttribute("content", /noindex/)
})

test("admin page /admin has noindex meta tag", async ({ page }) => {
  await authenticateAdminPage(page)
  await page.goto("/admin")

  const robotsMeta = page.locator('meta[name="robots"]')
  await expect(robotsMeta).toHaveAttribute("content", /noindex/)
})
