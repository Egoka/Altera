import { expect, test } from "./helpers/test"

test("flow #12 exports data, self-archives, and restores articles separately", async ({ page }) => {
  test.skip(true, "Requires T-021, T-034, T-035, and T-045 with export and mail fixtures")

  await test.step("Шаг 1: запросить и скачать выгрузку аккаунта", async () => {
    await page.goto("/me/export")
    await page.getByRole("button", { name: /запросить выгрузку|request export/i }).click()
    await expect(page.getByRole("link", { name: /скачать|download/i })).toBeVisible()
  })

  await test.step("Шаг 2: запросить письмо для самостоятельного архивирования", async () => {
    await page.goto("/me/delete")
    await page.getByRole("button", { name: /отправить письмо|send.*e-mail/i }).click()
  })

  await test.step("Шаг 3: подтвердить архивирование ссылкой из письма", async () => {
    await page.goto("/me/delete/confirm?token=fake-self-archive-token")
    await expect(page).toHaveURL(/\/$/)

    await page.goto("/me")
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    const articleResponse = await page.request.get("/self-archive-fixture-article")
    expect(articleResponse.status()).toBe(410)
  })

  await test.step("Шаг 4: войти в ограниченную сессию архивированного аккаунта", async () => {
    await page.goto("/auth/verify?token=fake-self-archived-login-token")
    await expect(page).toHaveURL(/\/me\/archived$/)
  })

  await test.step("Шаг 5: восстановить аккаунт, не восстанавливая статьи", async () => {
    await page.getByRole("button", { name: /восстановить аккаунт|restore account/i }).click()
    await expect(page).toHaveURL(/\/me(?:\?|$)/)
    await page.goto("/me/articles?status=archived")
    await expect(page.getByText(/self-archive fixture/i)).toBeVisible()
  })

  await test.step("Шаг 6: восстановить архивные статьи по одной", async () => {
    await page.goto("/me/articles?status=archived")
    await page
      .getByRole("button", { name: /восстановить|restore/i })
      .first()
      .click()
    await expect(page.getByText(/published|draft|опубликован|черновик/i)).toBeVisible()
  })
})
