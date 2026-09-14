import { expect, test } from "@playwright/test"

test("flow #12 exports data, self-archives, and restores articles separately", async ({ page }) => {
  test.skip(true, "Requires T-021, T-034, T-035, and T-045 with export and mail fixtures")

  await test.step("request and download the account export", async () => {
    await page.goto("/me/export")
    await page.getByRole("button", { name: /запросить выгрузку|request export/i }).click()
    await expect(page.getByRole("link", { name: /скачать|download/i })).toBeVisible()
  })

  await test.step("confirm self-archive by email", async () => {
    await page.goto("/me/delete")
    await page.getByRole("button", { name: /отправить письмо|send.*e-mail/i }).click()
    await page.goto("/me/delete/confirm?token=fake-self-archive-token")
    await expect(page).toHaveURL(/\/$/)

    await page.goto("/me")
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    const articleResponse = await page.request.get("/self-archive-fixture-article")
    expect(articleResponse.status()).toBe(410)
  })

  await test.step("enter a limited session and restore only the account", async () => {
    await page.goto("/auth/verify?token=fake-self-archived-login-token")
    await expect(page).toHaveURL(/\/me\/archived$/)
    await page.getByRole("button", { name: /восстановить аккаунт|restore account/i }).click()
    await expect(page).toHaveURL(/\/me(?:\?|$)/)
    await page.goto("/me/articles?status=archived")
    await expect(page.getByText(/self-archive fixture/i)).toBeVisible()
  })

  await test.step("restore archived articles one at a time", async () => {
    await page.goto("/me/articles?status=archived")
    await page
      .getByRole("button", { name: /восстановить|restore/i })
      .first()
      .click()
    await expect(page.getByText(/published|draft|опубликован|черновик/i)).toBeVisible()
  })
})
