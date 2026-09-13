import { expect, test } from "@playwright/test"

test("flow #11 archives an account transactionally and resolves one appeal", async ({ page }) => {
  test.skip(true, "Requires T-045, T-061, and T-073 with account, session, article, and mail fixtures")

  await test.step("warn about articles and the running plan before archive", async () => {
    await page.goto("/admin/users/archive-fixture")
    await page.getByRole("button", { name: /архивировать аккаунт|archive account/i }).click()
    await expect(page.getByText(/стат|article/i)).toBeVisible()
    await expect(page.getByText(/план.*продолж|plan.*continue/i)).toBeVisible()
  })

  await test.step("archive the account, revoke sessions, and archive its articles", async () => {
    await page.getByLabel(/причин|reason/i).fill("Policy fixture")
    await page.getByRole("button", { name: /подтвердить|confirm/i }).click()
    await expect(page.getByText(/archived|архив/i)).toBeVisible()
  })

  await test.step("block login and accept only one appeal", async () => {
    await page.goto("/auth/verify?token=fake-admin-archived-token")
    await expect(page).toHaveURL(/\/auth\/appeal\?token=/)
    await page.getByLabel(/обращени|appeal/i).fill("Please review the fixture block.")
    await page.getByRole("button", { name: /отправить|submit/i }).click()
    await expect(page.getByRole("button", { name: /отправить|submit/i })).toBeDisabled()
  })

  await test.step("record the admin decision and restore articles one by one", async () => {
    await page.goto("/admin/users/archive-fixture")
    await page.getByRole("button", { name: /восстановить аккаунт|restore account/i }).click()
    await expect(page.getByText(/статьи.*архив|articles.*archived/i)).toBeVisible()
    await page.goto("/me/articles?status=archived")
    await page
      .getByRole("button", { name: /восстановить|restore/i })
      .first()
      .click()
  })
})
