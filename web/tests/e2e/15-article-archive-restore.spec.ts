import { expect, test } from "./helpers/test"

test("flow #15 enforces archive actor hierarchy and restores the correct article state", async ({ page }) => {
  test.skip(true, "Requires T-045, T-068, and T-073 with article, media, and role fixtures")

  await test.step("Шаг 1: автор архивирует свою статью", async () => {
    await page.goto("/me/articles")
    await page
      .getByRole("button", { name: /удалить|archive/i })
      .first()
      .click()
    await page.getByRole("button", { name: /подтвердить|confirm/i }).click()
    const articleResponse = await page.request.get("/archived-fixture")
    expect(articleResponse.status()).toBe(410)
    const mediaResponse = await page.request.get("/media/archived-fixture.jpg")
    expect(mediaResponse.ok()).toBe(false)
  })

  await test.step("Шаг 1с: сотрудник архивирует статью с причиной", async () => {
    await page.goto("/admin/articles/staff-archive-fixture")
    await page.getByRole("button", { name: /архивировать|archive/i }).click()
    await page.getByLabel(/причин|reason/i).fill("Policy fixture")
    await page.getByRole("button", { name: /подтвердить|confirm/i }).click()
  })

  await test.step("Шаг 2: показать архив с актором архивирования", async () => {
    await page.goto("/me/articles?status=archived")
    await expect(page.getByText(/архивировал.*вы|archived by you/i)).toBeVisible()
  })

  await test.step("Шаг 3: восстановить свою статью при активном плане", async () => {
    await page.goto("/me/articles?status=archived")
    await page
      .getByRole("button", { name: /восстановить|restore/i })
      .first()
      .click()
    await expect(page.getByText(/published|draft|опубликован|черновик/i)).toBeVisible()
  })

  await test.step("Шаг 3о: позволить owner восстановить статью, архивированную сотрудником", async () => {
    await page.goto("/me/articles?status=archived")
    await expect(page.getByText(/архивировала редакция|archived by staff/i)).toBeVisible()
    await expect(page.getByRole("button", { name: /восстановить|restore/i })).toHaveCount(0)
    await page.goto("/admin/articles/archived-published-fixture")
    await page.getByRole("button", { name: /восстановить|restore/i }).click()
    await expect(page.getByText(/published|опубликован/i)).toBeVisible()
    await page.goto("/admin/articles/archived-draft-fixture")
    await page.getByRole("button", { name: /восстановить|restore/i }).click()
    await expect(page.getByText(/draft|черновик/i)).toBeVisible()
  })
})
