import { expect, test } from "@playwright/test"

test("cabinet page /me has noindex meta tag", async ({ page }) => {
  await page.goto("/me")

  const robotsMeta = page.locator('meta[name="robots"]')
  await expect(robotsMeta).toHaveAttribute("content", /noindex/)
})

test("admin page /admin has noindex meta tag", async ({ page }) => {
  await page.goto("/admin")

  const robotsMeta = page.locator('meta[name="robots"]')
  await expect(robotsMeta).toHaveAttribute("content", /noindex/)
})
