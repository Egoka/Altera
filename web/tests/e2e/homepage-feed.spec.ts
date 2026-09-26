import { expect, test, type Page } from "./helpers/test"

// Строки состояний `docs/spec/20-public/home.md` §8 в браузере.
//
// База браузерной проверки поднимается миграциями без seed, поэтому первый заход на главную
// показывает строку «Пусто». Остальные строки задаются перехватом ответа `feed`: SSR-запрос
// уходит мимо браузера, а клиентский переход на главную выполняет его уже в странице.

const card = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  slug: `slug-${id}`,
  sectionSlug: "culture",
  sectionName: "Культура",
  title: `Материал ${id}`,
  dek: "Подзаголовок материала",
  cover: null,
  publishedAt: "2026-09-18T10:00:00.000Z",
  isTranslation: false,
  author: { name: "Автор", handle: "author", grade: "standard" },
  ...overrides
})

const section = (key: string, count: number) => ({
  key,
  caption: "by_publication_date",
  items: Array.from({ length: count }, (_, index) => card(`${key}-${index + 1}`))
})

const stubFeed = async (page: Page, body: unknown) => {
  await page.route("**/api/graphql", async (route) => {
    if (!(route.request().postData() ?? "").includes("GetHomeFeed")) return route.continue()

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
  })
}

/** Клиентский переход на русскую главную: запрос подборок уходит из браузера. */
const openHomeFromEnglish = async (page: Page) => {
  await page.goto("/en")
  await page.getByRole("link", { name: "Switch language to Русский" }).click()
  await expect(page).toHaveURL(/\/$/)
}

test("пустая база: главная оставляет шапку, приглашение авторам и футер", { tag: "@empty-db" }, async ({ page }) => {
  await page.goto("/")

  await expect(page).toHaveTitle("Altera")
  await expect(page.getByRole("link", { name: /^Altera/ }).first()).toBeVisible()
  await expect(page.getByRole("heading", { name: "Здесь пока пусто" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Стать автором" })).toHaveAttribute("href", "/pricing")
  await expect(page.locator("section.featured-articles")).toHaveCount(0)
  await expect(page.locator('img[src*="picsum.photos"], img[src*="images.unsplash.com"]')).toHaveCount(0)
})

test(
  "английская главная на пустой базе показывает приглашение своей локали",
  { tag: "@empty-db" },
  async ({ page }) => {
    await page.goto("/en")

    await expect(page.getByRole("heading", { name: "Nothing here yet" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Become an author" })).toHaveAttribute("href", "/pricing")
  }
)

test("подборки рисуются в порядке ответа и ведут на материал", async ({ page }) => {
  await stubFeed(page, { data: { feed: { locale: "ru", sections: [section("top", 5), section("new", 3)] } } })
  await openHomeFromEnglish(page)

  const top = page.locator('section[data-section="top"]')
  await expect(top).toBeVisible()
  await expect(top.getByText("по дате публикации")).toBeVisible()
  await expect(top.getByRole("link", { name: "Материал top-1" }).first()).toHaveAttribute("href", "/culture/slug-top-1")
  await expect(page.getByRole("heading", { name: "Новое" })).toBeVisible()
  await expect(page.locator('section[data-section="popular"]')).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Здесь пока пусто" })).toHaveCount(0)
})

test("отказ подборок показывает состояние ошибки с кодом запроса", async ({ page }) => {
  await stubFeed(page, {
    errors: [{ message: "feed failed", extensions: { code: "INTERNAL_ERROR", requestId: "req-e2e" } }]
  })
  await openHomeFromEnglish(page)

  await expect(page.getByRole("heading", { name: "Не удалось загрузить материалы" })).toBeVisible()
  await expect(page.getByText("Код запроса: req-e2e")).toBeVisible()
  await expect(page.getByRole("link", { name: "Написать в редакцию" })).toBeVisible()
})

test("«Писать» ведёт в создание материала", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("link", { name: "Писать" })).toHaveAttribute("href", "/me/articles/new")
})
