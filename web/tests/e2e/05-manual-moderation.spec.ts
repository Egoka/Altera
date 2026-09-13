import { expect, test } from "@playwright/test"

test("flow #5 claims the oldest review and preserves every manual outcome", async ({ page }) => {
  test.skip(true, "Requires T-043, T-050, and T-051 with review and mail fixtures")

  await test.step("claim the oldest item and inspect its current revision", async () => {
    await page.goto("/admin/review")
    await page
      .getByRole("button", { name: /взять в работу|claim/i })
      .first()
      .click()
    await expect(page.getByText(/in_review|в работе/i)).toBeVisible()
    await expect(page.getByText(/причин|reason/i)).toBeVisible()
    await expect(page.getByText(/истори.*верс|revision history/i)).toBeVisible()
  })

  await test.step("request rework and accept the author's resubmission without another AI run", async () => {
    await page.getByLabel(/рекомендац|recommendation/i).fill("Clarify the cited source.")
    await page.getByRole("button", { name: /запросить доработку|request rework/i }).click()
    await expect(page.getByText(/rework|на доработке/i)).toBeVisible()
    await page.goto("/admin/review")
    await expect(page.getByText(/ответ автора|author reply/i)).toBeVisible()
  })

  await test.step("support manual publish, final rejection, and unpublish branches", async () => {
    await page.goto("/admin/review/manual-publish-fixture")
    await page.getByRole("button", { name: /опубликовать вручную|publish manually/i }).click()
    await expect(page.getByText(/published|опубликован/i)).toBeVisible()
    await page.goto("/admin/review/final-reject-fixture")
    await page.getByRole("button", { name: /окончательн.*отказ|final reject/i }).click()
    await expect(page.getByText(/отклонена редакцией|final rejection/i)).toBeVisible()
    await page.goto("/admin/articles/published-fixture")
    await page.getByRole("button", { name: /снять с публикации|unpublish/i }).click()
    await expect(page.getByText(/review|ручн.*проверк/i)).toBeVisible()
  })
})
