import { expect, test } from "@playwright/test"

test("flow #15 enforces archive actor hierarchy and restores the correct article state", async ({ page }) => {
  test.skip(true, "Requires T-045, T-068, and T-073 with article, media, and role fixtures")

  await test.step("self-archive and expose the archive actor", async () => {
    await page.goto("/me/articles")
    await page
      .getByRole("button", { name: /удалить|archive/i })
      .first()
      .click()
    await page.getByRole("button", { name: /подтвердить|confirm/i }).click()
    await page.goto("/me/articles?status=archived")
    await expect(page.getByText(/архивировал.*вы|archived by you/i)).toBeVisible()
  })

  await test.step("remove public article and media access", async () => {
    const articleResponse = await page.request.get("/archived-fixture")
    expect(articleResponse.status()).toBe(410)
    const mediaResponse = await page.request.get("/media/archived-fixture.jpg")
    expect(mediaResponse.ok()).toBe(false)
  })

  await test.step("prevent an author from undoing a staff archive", async () => {
    await page.goto("/me/articles?status=archived")
    await expect(page.getByText(/архивировала редакция|archived by staff/i)).toBeVisible()
    await expect(page.getByRole("button", { name: /восстановить|restore/i })).toHaveCount(0)
  })

  await test.step("let the owner restore and preserve published versus draft state", async () => {
    await page.goto("/admin/articles/archived-published-fixture")
    await page.getByRole("button", { name: /восстановить|restore/i }).click()
    await expect(page.getByText(/published|опубликован/i)).toBeVisible()
    await page.goto("/admin/articles/archived-draft-fixture")
    await page.getByRole("button", { name: /восстановить|restore/i }).click()
    await expect(page.getByText(/draft|черновик/i)).toBeVisible()
  })
})
