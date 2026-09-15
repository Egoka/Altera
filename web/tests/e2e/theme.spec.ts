import { expect, test } from "@playwright/test"

test("theme switches through Nuxt color mode and semantic tokens", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" })

  await page.goto("/")

  const lightRoot = page.locator("html")
  await expect(lightRoot).not.toHaveClass(/\bdark\b/)
  await expect(lightRoot).toHaveCSS("background-color", "rgb(250, 249, 247)")

  const darkPage = await page.context().newPage()
  await darkPage.addInitScript(() => {
    localStorage.setItem("nuxt-color-mode", "dark")
    localStorage.setItem("theme", "light")
  })
  await darkPage.goto("/")

  const darkRoot = darkPage.locator("html")
  await expect(darkRoot).toHaveClass(/\bdark\b/)
  await expect(darkRoot).toHaveCSS("background-color", "rgb(17, 17, 17)")
})
