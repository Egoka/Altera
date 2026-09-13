import { expect, test } from "@playwright/test"

test("flow #3 moves a draft through AI and the manual review branch", async ({ page }) => {
  test.skip(true, "Requires T-040, T-048, T-049, T-050, T-051, T-064, and T-066")

  await test.step("create and edit a draft with media, licence, and SEO", async () => {
    await page.goto("/me/articles/new")
    await expect(page).toHaveURL(/\/me\/articles\/[^/]+\/edit$/)
    await page.getByLabel(/заголовок|title/i).fill("Launch fixture article")
    await page.getByLabel(/текст|body/i).fill("A complete launch fixture body.")
    await page.getByLabel(/лицензия|licen[cs]e/i).selectOption("own")
    await page.getByLabel(/seo/i).fill("launch-fixture")
  })

  await test.step("submit the first revision to ai_check and publish an allowed fixture", async () => {
    await page.getByRole("button", { name: /отправить к публикации|submit/i }).click()
    await expect(page.getByText(/ai_check|автоматическ.*проверк/i)).toBeVisible()
    await page.goto("/launch-fixture")
    await expect(page.getByRole("heading", { name: "Launch fixture article" })).toBeVisible()
  })

  await test.step("send a rejected AI fixture through rework and final reviewer outcome", async () => {
    await page.goto("/me/articles/rejected-fixture/review")
    await expect(page.getByText(/причин|reason/i)).toBeVisible()
    await page.getByRole("link", { name: /доработать|edit/i }).click()
    await page.getByLabel(/текст|body/i).fill("A corrected launch fixture body.")
    await page.getByRole("button", { name: /отправить|submit/i }).click()
    await expect(page.getByText(/ручн.*проверк|manual review/i)).toBeVisible()
    await expect(page.getByText(/доработк|опубликован|отклонен|rework|published|rejected/i)).toBeVisible()
  })
})
