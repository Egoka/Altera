import { expect, test } from "./helpers/test"

test("flow #4 offers one re-edit within an hour and routes resubmission through AI", async ({ page }) => {
  test.skip(true, "Requires T-044, T-049, and T-051 with a controllable clock")

  await test.step("Ветка «Перередактировать»: показать кнопку один раз в течение часа после автопубликации", async () => {
    await page.goto("/me/articles/autopublished-fixture")
    await expect(page.getByRole("button", { name: /перередактировать|re-edit/i })).toBeVisible()
  })

  await test.step("Ветка «Перередактировать»: снять статью с публикации в draft", async () => {
    await page.getByRole("button", { name: /перередактировать|re-edit/i }).click()
    await expect(page.getByText(/draft|черновик/i)).toBeVisible()
  })

  await test.step("Ветка «Перередактировать»: исправить и повторно отправить через AI", async () => {
    await page.getByRole("link", { name: /редактировать|edit/i }).click()
    await page.getByRole("button", { name: /отправить|submit/i }).click()
    await expect(page.getByText(/ai_check|автоматическ.*проверк/i)).toBeVisible()
  })

  await test.step("Ветка «Перередактировать»: скрыть кнопку после повторного использования или истечения срока", async () => {
    await page.goto("/me/articles/autopublished-fixture")
    await expect(page.getByRole("button", { name: /перередактировать|re-edit/i })).toHaveCount(0)
    await page.goto("/me/articles/expired-reedit-fixture")
    await expect(page.getByRole("button", { name: /перередактировать|re-edit/i })).toHaveCount(0)
  })
})
