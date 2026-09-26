import { expect, test } from "./helpers/test"
import { setSessionCookie } from "./helpers/auth-fixtures"

const articles = {
  published: {
    id: "article-published",
    title: "Город, который слушает море",
    slug: "gorod-slushaet-more",
    locale: "ru",
    cover: null,
    publishedAt: "2026-09-10T12:00:00.000Z",
    available: true,
    author: { name: "Анна Волкова", handle: "anna-volkova" },
    section: { name: "Путешествия", slug: "travel" }
  },
  archived: {
    id: "article-archived",
    title: "Снятый материал",
    slug: "snyatyy-material",
    locale: "ru",
    cover: null,
    publishedAt: null,
    available: false,
    author: { name: "Пётр Ильин", handle: "petr-ilin" },
    section: { name: "Культура", slug: "culture" }
  }
}

const items = [
  { bookmarkedAt: "2026-09-18T10:00:00.000Z", article: articles.archived },
  { bookmarkedAt: "2026-09-17T10:00:00.000Z", article: articles.published }
]

const stubBookmarks = async (page: import("./helpers/test").Page) => {
  const removed: string[] = []

  await page.route("**/api/graphql", async (route) => {
    const body = route.request().postDataJSON() as {
      query: string
      variables?: { unavailable?: boolean; articleId?: string }
    }

    if (body.query.includes("mutation RemoveBookmark")) {
      removed.push(body.variables?.articleId ?? "")
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { removeBookmark: { articleId: body.variables?.articleId, bookmarked: false } }
        })
      })
      return
    }

    const visible = body.variables?.unavailable ? items.filter((item) => !item.article.available) : items

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          myBookmarks: {
            items: visible,
            counts: { total: items.length, unavailable: 1 },
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      })
    })
  })

  return removed
}

test("keeps an archived article in bookmarks as unavailable", async ({ page }) => {
  await stubBookmarks(page)
  await setSessionCookie(page, "t022-bookmarks")
  await page.goto("/me/bookmarks")

  await expect(page.getByRole("heading", { name: "Закладки · 2" })).toBeVisible()

  const archived = page.getByRole("article", { name: "Снятый материал" })
  await expect(archived).toBeVisible()
  await expect(archived).toHaveAttribute("data-available", "false")
  await expect(archived.getByTestId("bookmark-unavailable")).toHaveText("Недоступна")
  // Содержание недоступного материала не открывается: заголовок не ссылка (журнал §25.10).
  await expect(archived.getByRole("link")).toHaveCount(0)
  await expect(archived.getByTestId("bookmark-remove")).toBeVisible()
  await expect(archived).toHaveCSS("filter", "grayscale(1)")
  await expect(archived).toHaveCSS("opacity", "0.6")

  const available = page.getByRole("article", { name: "Город, который слушает море" })
  await expect(available).toHaveAttribute("data-available", "true")
  await expect(available.getByRole("link", { name: "Город, который слушает море" })).toHaveAttribute(
    "href",
    "/travel/gorod-slushaet-more"
  )
  await expect(available).toHaveCSS("filter", "none")
})

test("filters the list down to unavailable bookmarks", async ({ page }) => {
  await stubBookmarks(page)
  await setSessionCookie(page, "t022-bookmarks")
  await page.goto("/me/bookmarks")

  await page.getByRole("link", { name: /Недоступные/ }).click()

  await expect(page).toHaveURL(/unavailable=1/)
  await expect(page.getByRole("article")).toHaveCount(1)
  await expect(page.getByRole("article", { name: "Снятый материал" })).toBeVisible()
})

test("removes a bookmark and offers to bring it back", async ({ page }) => {
  const removed = await stubBookmarks(page)
  await setSessionCookie(page, "t022-bookmarks")
  await page.goto("/me/bookmarks")

  await page.getByRole("article", { name: "Снятый материал" }).getByTestId("bookmark-remove").click()

  await expect(page.getByRole("article", { name: "Снятый материал" })).toHaveCount(0)
  await expect(page.getByTestId("bookmark-undo")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Закладки · 1" })).toBeVisible()
  expect(removed).toEqual(["article-archived"])
})
