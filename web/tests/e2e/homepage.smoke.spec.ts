import { expect, test } from "./helpers/test"

test("homepage exposes the required Altera document title", async ({ page }) => {
  await page.goto("/")

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole("link", { name: /^Altera/ }).first()).toBeVisible()
  await expect(page).toHaveTitle("Altera")
})
