import { expect, test } from "@playwright/test"

test("homepage opens and shows the accessible Altera brand", async ({ page }) => {
  await page.goto("/")

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole("link", { name: /^Altera/ }).first()).toBeVisible()
})
