import { expect, test } from "@playwright/test"
import { authenticateAdminPage } from "./helpers/admin-auth"

const themes = ["light", "dark"] as const

for (const theme of themes) {
  test(`admin table follows design-system tokens in ${theme} theme`, async ({ page }) => {
    await authenticateAdminPage(page)
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem("nuxt-color-mode", selectedTheme)
    }, theme)

    await page.goto("/admin/tags")

    const root = page.locator("html")
    const table = page.locator("[data-app-table]")
    const cell = table.locator(".ColumnClassTd").first()

    await expect(root).toHaveClass(theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/)
    await expect(table).toBeVisible()
    await expect(cell).toBeVisible()

    await root.evaluate((element) => {
      const html = element as HTMLElement
      html.style.setProperty("--color-surface", "rgb(1, 2, 3)")
      html.style.setProperty("--color-ink", "rgb(4, 5, 6)")
      html.style.setProperty("--color-rule", "rgb(7, 8, 9)")
    })

    await expect(cell).toHaveCSS("background-color", "rgb(1, 2, 3)")
    await expect(cell).toHaveCSS("color", "rgb(4, 5, 6)")
    await expect(cell).toHaveCSS("border-bottom-color", "rgb(7, 8, 9)")
  })
}
