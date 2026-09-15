import { expect, test } from "@playwright/test"

test("flow #11 archives an account transactionally and resolves one appeal", async ({ page }) => {
  test.skip(true, "Requires T-045, T-061, and T-073 with account, session, article, and mail fixtures")

  await test.step("Шаг 1: открыть карточку и получить предупреждение о статьях и действующем плане", async () => {
    await page.goto("/admin/users/archive-fixture")
    await page.getByRole("button", { name: /архивировать аккаунт|archive account/i }).click()
    await expect(page.getByText(/стат|article/i)).toBeVisible()
    await expect(page.getByText(/план.*продолж|plan.*continue/i)).toBeVisible()
  })

  await test.step("Шаг 2: подтвердить архивирование, отозвать сессии и архивировать статьи", async () => {
    await page.getByLabel(/причин|reason/i).fill("Policy fixture")
    await page.getByRole("button", { name: /подтвердить|confirm/i }).click()
    await expect(page.getByText(/archived|архив/i)).toBeVisible()
    await expect(page.getByText(/все сессии отозваны|all sessions revoked/i)).toBeVisible()
    await expect(page.getByText(/статьи.*архив|articles.*archived/i)).toBeVisible()

    const articleResponse = await page.request.get("/admin-archive-fixture-article")
    expect(articleResponse.status()).toBe(410)
  })

  await test.step("Шаг 3: направить попытку входа к форме оспаривания без создания сессии", async () => {
    await page.goto("/auth/verify?token=fake-admin-archived-token")
    await expect(page).toHaveURL(/\/auth\/appeal\?token=/)
  })

  await test.step("Шаг 4: подать единственное оспаривание", async () => {
    await page.getByLabel(/обращени|appeal/i).fill("Please review the fixture block.")
    await page.getByRole("button", { name: /отправить|submit/i }).click()
    await expect(page.getByRole("button", { name: /отправить|submit/i })).toBeDisabled()
  })

  await test.step("Шаг 5: принять решение по оспариванию и восстановить доступ к аккаунту", async () => {
    await page.goto("/admin/users/archive-fixture")
    await page.getByRole("tab", { name: /оспариван|appeal/i }).click()
    await expect(page.getByText(/Please review the fixture block/)).toBeVisible()
    await page.getByLabel(/причин.*решен|decision reason/i).fill("Appeal accepted after review.")
    await page.getByRole("button", { name: /восстановить аккаунт|restore account/i }).click()
    await expect(page.getByText(/аккаунт восстановлен|account restored/i)).toBeVisible()
    await expect(page.getByText(/статьи.*архив|articles.*archived/i)).toBeVisible()
  })

  await test.step("Шаг 6: вернуть архивные статьи по одной", async () => {
    await page.goto("/me/articles?status=archived")
    await page
      .getByRole("button", { name: /восстановить|restore/i })
      .first()
      .click()
    await expect(page.getByText(/published|опубликован/i)).toBeVisible()
  })
})
