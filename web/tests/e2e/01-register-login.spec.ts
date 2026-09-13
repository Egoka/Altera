import { expect, test } from "@playwright/test"

test("flow #1 registers or logs in without disclosing whether the account exists", async ({ page }) => {
  test.skip(true, "Requires T-021, T-022, T-023, T-035, T-061, and T-101")

  await test.step("request a magic link with current consent", async () => {
    await page.goto("/login")
    await page.getByLabel(/e-mail/i).fill("reader@example.test")
    await page.getByRole("checkbox", { name: /соглас|consent/i }).check()
    await page.getByRole("button", { name: /получить ссылку|get link/i }).click()
    await expect(page.getByText(/если адрес существует|if the address exists/i)).toBeVisible()
  })

  await test.step("consume the one-use 15-minute token from the fake mail transport", async () => {
    await page.goto("/auth/verify?token=fake-mail-token")
    await expect(page).toHaveURL(/\/me(?:\?|$)/)
    await page.goto("/auth/verify?token=fake-mail-token")
    await expect(page.getByText(/ссылка недействительна|link is invalid/i)).toBeVisible()
  })

  await test.step("route a self-archived account to its limited session", async () => {
    await page.goto("/auth/verify?token=fake-self-archived-token")
    await expect(page).toHaveURL(/\/me\/archived$/)
    await expect(page.getByRole("button", { name: /восстановить аккаунт|restore account/i })).toBeVisible()
  })
})
