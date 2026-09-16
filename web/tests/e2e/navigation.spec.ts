import { expect, test } from "@playwright/test"

test("меню шапки строится из ответа публичного navigation API", async ({ page }) => {
  await page.route("**/api/graphql", async (route) => {
    const query = route.request().postData() ?? ""
    if (!query.includes("GetNavigation")) return route.continue()

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          publicSections: [
            { id: "culture", name: "Культура", nameEn: "Culture", slug: "culture", order: 1, articleCount: 8 },
            { id: "travel", name: "Путешествия", nameEn: "Travel", slug: "travel", order: 2, articleCount: 3 }
          ],
          popularTags: { tags: [] }
        }
      })
    })
  })

  await page.goto("/")
  await page.getByRole("button", { name: "Рубрики" }).first().click()

  const menu = page.getByRole("navigation", { name: "Рубрики" })
  await expect(menu.getByRole("link", { name: /Культура/ })).toHaveAttribute("href", "/culture")
  await expect(menu.getByRole("link", { name: /Путешествия/ })).toHaveAttribute("href", "/travel")
})
