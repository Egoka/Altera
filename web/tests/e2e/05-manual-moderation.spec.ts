import { expect, test } from "./helpers/test"

test("flow #5 claims the oldest review and preserves every manual outcome", async ({ page }) => {
  test.skip(true, "Requires T-043, T-050, and T-051 with review and mail fixtures")

  await test.step("Шаг 1: взять в работу старшую заявку и закрепить review", async () => {
    await page.goto("/admin/review")
    await page
      .getByRole("button", { name: /взять в работу|claim/i })
      .first()
      .click()
    await expect(page.getByText(/in_review|в работе/i)).toBeVisible()
  })

  await test.step("Шаг 2: прочитать текущую ревизию, причины, историю и переписку", async () => {
    await expect(page.getByText(/причин|reason/i)).toBeVisible()
    await expect(page.getByText(/истори.*верс|revision history/i)).toBeVisible()
  })

  await test.step("Шаг 3а: запросить доработку с рекомендациями, привязанными к ревизии", async () => {
    await page.getByLabel(/рекомендац|recommendation/i).fill("Clarify the cited source.")
    await page.getByRole("button", { name: /запросить доработку|request rework/i }).click()
    await expect(page.getByText(/rework|на доработке/i)).toBeVisible()
  })

  await test.step("Шаг 3б: вручную опубликовать материал", async () => {
    await page.goto("/admin/review/manual-publish-fixture")
    await page.getByRole("button", { name: /опубликовать вручную|publish manually/i }).click()
    await expect(page.getByText(/published|опубликован/i)).toBeVisible()
  })

  await test.step("Шаг 3в: оформить окончательный отказ", async () => {
    await page.goto("/admin/review/final-reject-fixture")
    await page.getByRole("button", { name: /окончательн.*отказ|final reject/i }).click()
    await expect(page.getByText(/отклонена редакцией|final rejection/i)).toBeVisible()
  })

  await test.step("Шаг 4: автор отвечает, закрывает замечания и правит материал", async () => {
    await page.goto("/me/articles/rework-fixture/review")
    await expect(page.getByText(/Clarify the cited source/)).toBeVisible()
    await page.getByLabel(/ответ|reply/i).fill("The citation now names the primary source.")
    await page.getByRole("button", { name: /отправить ответ|send reply/i }).click()
    await page.getByRole("checkbox", { name: /замечание решено|note resolved/i }).check()
    await page.getByRole("link", { name: /редактировать|edit/i }).click()
    await page.getByLabel(/текст|body/i).fill("A revised body with the primary citation.")
  })

  await test.step("Шаг 5: повторно отправить материал прямо в review без нового AI", async () => {
    await page.getByRole("button", { name: /отправить|submit/i }).click()
    await expect(page.getByText(/^review$|ручн.*проверк/i)).toBeVisible()
    await expect(page.getByText(/^ai_check$/i)).toHaveCount(0)

    await page.goto("/admin/review/rework-fixture")
    await expect(page.getByText(/ответ автора|author reply/i)).toBeVisible()
    await expect(page.getByText(/истори.*верс|revision history/i)).toBeVisible()
  })

  await test.step("Шаг С: снять опубликованную статью на доработку", async () => {
    await page.goto("/admin/articles/published-fixture")
    await page.getByRole("button", { name: /снять с публикации|unpublish/i }).click()
    await expect(page.getByText(/review|ручн.*проверк/i)).toBeVisible()
  })
})
