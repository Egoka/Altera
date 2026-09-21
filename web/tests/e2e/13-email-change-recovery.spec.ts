import { expect, test } from "@playwright/test"

/**
 * Шаги 1–3 закрыты T-032 и проверяются в `32-email-change.spec.ts` на живой базе и почте.
 * Здесь остаётся ветка восстановления доступа: она ждёт страницу обращений (`/contact`, T-073)
 * и экран смены e-mail в карточке пользователя (`40-admin/users.md`, заход 7).
 */
test("flow #13 changes email without ending sessions and supports audited recovery", async ({ page }) => {
  test.skip(true, "Recovery branch requires /contact (T-073) and the admin e-mail change screen (matrix #50)")

  await test.step("Шаг 1: запросить одноразовый код на новый e-mail", async () => {
    await page.goto("/me/email")
    await page.getByLabel(/нов.*e-mail|new e-mail/i).fill("new-address@example.test")
    await page.getByRole("button", { name: /отправить код|send code/i }).click()
  })

  await test.step("Шаг 2: ввести код и сменить e-mail без завершения сессий", async () => {
    await page.getByLabel(/код|code/i).fill("123456")
    await page.getByRole("button", { name: /подтвердить|confirm/i }).click()
    await expect(page.getByText(/адрес изменен|address changed/i)).toBeVisible()
  })

  await test.step("Шаг 3: показать изменённый адрес и уведомление на прежнюю почту", async () => {
    await page.reload()
    await expect(page).toHaveURL(/\/me\/email$/)
    await expect(page.getByText(/уведомление отправлено|notification sent/i)).toBeVisible()
  })

  await test.step("Шаг Р1: создать обращение о потере доступа к почте", async () => {
    await page.goto("/contact")
    await page.getByLabel(/тема|topic/i).selectOption("access_recovery")
    await page.getByRole("button", { name: /отправить|submit/i }).click()
  })

  await test.step("Шаг Р2: сменить e-mail сотрудником с причиной и аудитом", async () => {
    await page.goto("/admin/users/recovery-fixture")
    await page.getByLabel(/нов.*e-mail|new e-mail/i).fill("recovered@example.test")
    await page.getByLabel(/причин|reason/i).fill("Identity verified")
    await page.getByRole("button", { name: /изменить e-mail|change e-mail/i }).click()
    await expect(page.getByText(/аудит|audit/i)).toContainText(/user\.email\.change/i)
  })

  await test.step("Шаг Р3: войти по новому адресу", async () => {
    await page.goto("/login")
    await page.getByLabel(/e-mail/i).fill("recovered@example.test")
  })
})
