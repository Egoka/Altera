import { expect, test, type Page } from "@playwright/test"

// Flow #2 «Стать автором», шаг 1 (become-author.md): первое «Создать статью» бессрочно открывает
// базовые авторские возможности, сразу создаёт черновик и открывает редактор (журнал §25.1, §25.3).
const emptyMyArticles = {
  items: [],
  counts: { total: 0, draft: 0, ai_check: 0, review: 0, rework: 0, published: 0, rejected: 0, archived: 0 },
  pageInfo: { endCursor: null, hasNextPage: false }
}

type CreateArticleOutcome = Record<string, unknown>

const mockApi = async (page: Page, createArticle: CreateArticleOutcome) => {
  const createVariables: Array<Record<string, unknown>> = []

  await page.route("**/api/graphql", async (route) => {
    const body = route.request().postDataJSON() as { query: string; variables?: Record<string, unknown> }

    if (body.query.includes("mutation CreateArticle")) {
      createVariables.push(body.variables ?? {})
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: null, ...createArticle })
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { myArticles: emptyMyArticles } })
    })
  })

  return createVariables
}

test("шаг 1: «Создать статью» создаёт черновик и сразу открывает его редактор", async ({ page }) => {
  const createVariables = await mockApi(page, {
    data: { createArticle: { id: "article-1", slug: "draft-article-1", title: "" } }
  })

  await page.goto("/me/articles")
  await page.getByRole("link", { name: "Создать статью" }).click()

  await expect(page).toHaveURL(/\/me\/articles\/article-1\/edit$/)
  // Рубрика, формат и теги при создании не требуются (article-new.md §1).
  expect(createVariables).toEqual([{ input: {} }])
})

test("развилка шага 1: служебная запись получает FORBIDDEN вместо черновика", async ({ page }) => {
  const createVariables = await mockApi(page, {
    errors: [{ message: "Action forbidden", extensions: { code: "FORBIDDEN" } }]
  })

  await page.goto("/me/articles")
  await page.getByRole("link", { name: "Создать статью" }).click()

  // Отказ не открывает редактор: пользователь остаётся на точке действия (article-new.md §3).
  await expect(page).toHaveURL(/\/me\/articles\/new$/)
  await expect(page.getByRole("heading", { name: "Мои материалы" })).toHaveCount(0)
  expect(createVariables).toHaveLength(1)
})
