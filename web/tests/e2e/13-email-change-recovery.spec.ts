import { expect, test } from "@playwright/test"

test("flow #13 changes email without ending sessions and supports audited recovery", async ({ page }) => {
  test.skip(true, "Requires T-021, T-032, and T-073 with mail, session, support, and audit fixtures")

  await test.step("send and confirm a code at the new address", async () => {
    await page.goto("/me/email")
    await page.getByLabel(/нов.*e-mail|new e-mail/i).fill("new-address@example.test")
    await page.getByRole("button", { name: /отправить код|send code/i }).click()
    await page.getByLabel(/код|code/i).fill("123456")
    await page.getByRole("button", { name: /подтвердить|confirm/i }).click()
    await expect(page.getByText(/адрес изменен|address changed/i)).toBeVisible()
  })

  await test.step("preserve existing sessions and notify the old address", async () => {
    await page.reload()
    await expect(page).toHaveURL(/\/me\/email$/)
    await expect(page.getByText(/уведомление отправлено|notification sent/i)).toBeVisible()
  })

  await test.step("recover access through an audited admin change", async () => {
    await page.goto("/contact")
    await page.getByLabel(/тема|topic/i).selectOption("access_recovery")
    await page.getByRole("button", { name: /отправить|submit/i }).click()
    await page.goto("/admin/users/recovery-fixture")
    await page.getByLabel(/нов.*e-mail|new e-mail/i).fill("recovered@example.test")
    await page.getByLabel(/причин|reason/i).fill("Identity verified")
    await page.getByRole("button", { name: /изменить e-mail|change e-mail/i }).click()
    await expect(page.getByText(/аудит|audit/i)).toContainText(/user\.email\.change/i)
    await page.goto("/login")
    await page.getByLabel(/e-mail/i).fill("recovered@example.test")
  })
})
