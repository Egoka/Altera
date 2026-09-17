import { expect, test } from "@playwright/test"

const allItems = [
  ["draft", "Материал в черновике", false],
  ["ai_check", "Проверка ИИ", false],
  ["review", "Ожидает рецензента", false],
  ["in_review", "У рецензента", false],
  ["rework", "Материал на доработке", false],
  ["published", "Опубликованный материал", false],
  ["review", "Отклонённый материал", true],
  ["archived", "Архивный материал", false]
].map(([status, title, rejected], index) => ({
  id: `article-${index}`,
  status,
  archivedBy: status === "archived" ? "staff" : null,
  section: null,
  format: null,
  tags: [],
  translations: [
    {
      id: `translation-${index}`,
      locale: "ru",
      slug: `article-${index}`,
      title,
      status,
      rejected,
      publishedAt: status === "published" ? "2026-09-10T12:00:00.000Z" : null,
      updatedAt: `2026-09-${String(17 - index).padStart(2, "0")}T12:00:00.000Z`,
      reeditUntil: status === "published" ? "2026-09-17T18:00:00.000Z" : null,
      lastReviewMessageAt: status === "rework" || rejected ? "2026-09-17T10:00:00.000Z" : null,
      unread: status === "rework" || rejected
    }
  ]
}))

test("shows every author article state and keeps rejected material read-only", async ({ page }) => {
  await page.route("**/api/graphql", async (route) => {
    const body = route.request().postDataJSON() as { variables?: { status?: string[] } }
    const statuses = body.variables?.status ?? []
    const items = statuses.includes("rejected") ? allItems.filter((item) => item.translations[0]?.rejected) : allItems

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          myArticles: {
            items,
            counts: {
              total: 8,
              draft: 1,
              ai_check: 1,
              review: 2,
              rework: 1,
              published: 1,
              rejected: 1,
              archived: 1
            },
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      })
    })
  })

  await page.goto("/me/articles")

  await expect(page.getByRole("heading", { name: "Мои материалы" })).toBeVisible()
  await expect(page.getByText("Черновик", { exact: true })).toBeVisible()
  await expect(page.getByText("Проверяется", { exact: true })).toBeVisible()
  await expect(page.getByText("На проверке", { exact: true })).toHaveCount(2)
  await expect(page.getByText("На доработке: есть рекомендации", { exact: true })).toBeVisible()
  await expect(page.getByText(/Перередактировать до/)).toBeVisible()
  await expect(page.getByText("Отклонена редакцией, только чтение", { exact: true })).toBeVisible()
  await expect(page.getByText("Архивировала редакция", { exact: true })).toBeVisible()

  await page.getByRole("link", { name: /Отклонённые/ }).click()
  await expect(page).toHaveURL(/status=rejected/)
  const rejectedRow = page.getByRole("article", { name: "Отклонённый материал" })
  await expect(rejectedRow.getByRole("link", { name: "Открыть для чтения" })).toHaveAttribute(
    "href",
    "/me/articles/article-6"
  )
  await expect(rejectedRow.getByRole("link", { name: /Редактировать/ })).toHaveCount(0)
})
