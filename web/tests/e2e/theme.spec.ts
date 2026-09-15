import { expect, test } from "@playwright/test"

test("theme switches through Nuxt color mode and semantic tokens", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" })

  await page.goto("/components-showcase")

  const root = page.locator("html")
  await expect(root).not.toHaveClass(/\bdark\b/)
  await expect(root).toHaveCSS("background-color", "rgb(250, 249, 247)")

  await page.evaluate(() => localStorage.setItem("nuxt-color-mode", "dark"))
  await page.reload()

  await expect(root).toHaveClass(/\bdark\b/)
  await expect(root).toHaveCSS("background-color", "rgb(17, 17, 17)")
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull()
})
