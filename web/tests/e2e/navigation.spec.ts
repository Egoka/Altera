import { expect, test, type Page } from "./helpers/test"

/**
 * Меню шапки строится из публичного `publicSections` и живёт в локали страницы (T-129).
 * Запрос уходит при отрисовке страницы, поэтому подставленный ответ доходит до шапки
 * только браузерным запросом: переключатель языка делает клиентский переход и
 * перезапрашивает меню уже из страницы. Присутствие меню в ответе SSR проверяет
 * `129-public-locale-links.spec.ts` на настоящих данных.
 */
const sections = [
  { id: "culture", name: "Культура", nameEn: "Culture", slug: "culture", order: 1, articleCount: 8 },
  { id: "travel", name: "Путешествия", nameEn: "Travel", slug: "travel", order: 2, articleCount: 3 }
]

const stubNavigation = async (page: Page) => {
  await page.route("**/api/graphql", async (route) => {
    const query = route.request().postData() ?? ""
    if (!query.includes("GetNavigation")) return route.continue()

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { publicSections: sections, popularTags: [] } })
    })
  })
}

test("меню шапки строится из ответа публичного navigation API", async ({ page }) => {
  await stubNavigation(page)

  await page.goto("/en")
  await page.getByRole("link", { name: "Switch language to Русский" }).click()
  await expect(page).toHaveURL(/\/$/)
  // Закрытое меню скрыто `display: none` и в дерево доступности не попадает.
  await page.getByRole("button", { name: "Рубрики" }).first().click()

  const menu = page.getByRole("navigation", { name: "Рубрики" })
  await expect(menu.getByRole("link", { name: /Культура/ })).toHaveAttribute("href", "/culture")
  await expect(menu.getByRole("link", { name: /Путешествия/ })).toHaveAttribute("href", "/travel")
})

// AC-1 и AC-3 T-129: английское меню называет рубрики `nameEn` и ведёт в свою локаль.
test("на /en меню шапки называет рубрики nameEn и ведёт в английские ленты", async ({ page }) => {
  await stubNavigation(page)

  await page.goto("/")
  await page.getByRole("link", { name: "Switch language to English" }).click()
  await expect(page).toHaveURL(/\/en$/)
  await page.getByRole("button", { name: "Sections" }).first().click()

  const menu = page.getByRole("navigation", { name: "Sections" })
  await expect(menu.getByRole("link", { name: /Culture/ })).toHaveAttribute("href", "/en/culture")
  await expect(menu.getByRole("link", { name: /Travel/ })).toHaveAttribute("href", "/en/travel")
  await expect(menu.getByRole("link", { name: /Культура/ })).toHaveCount(0)
})
