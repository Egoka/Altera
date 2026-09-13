import { expect, test } from "@playwright/test"

test("flow #16 permanently deletes only an archived entity after exact confirmation", async ({ page }) => {
  test.skip(true, "Requires T-076; destructive flow must run only against its isolated fixture environment")

  await test.step("show the owner a cascade preview for an archived entity", async () => {
    await page.goto("/admin/articles/permanent-delete-fixture")
    await page.getByRole("button", { name: /удалить навсегда|delete permanently/i }).click()
    await expect(page.getByText(/верс|медиа|аудит|version|media|audit/i)).toBeVisible()
  })

  await test.step("reject a mismatched name and conflicting entity state", async () => {
    await page.getByLabel(/точное имя|exact name/i).fill("wrong name")
    await page.getByLabel(/причин|reason/i).fill("Fixture cleanup")
    await page.getByRole("button", { name: /подтвердить|confirm/i }).click()
    await expect(page.getByText(/имя не совпадает|name does not match/i)).toBeVisible()
  })

  await test.step("delete transactionally and retain the immutable audit", async () => {
    await page.getByLabel(/точное имя|exact name/i).fill("Permanent delete fixture")
    await page.getByRole("button", { name: /подтвердить|confirm/i }).click()
    const deletedResponse = await page.request.get("/permanent-delete-fixture")
    expect(deletedResponse.status()).toBe(404)
    await page.goto("/admin/audit")
    await expect(page.getByText(/entity\.delete\.permanent/i)).toBeVisible()
  })

  await test.step("keep the slug reserved and block invalid owner or relation cases", async () => {
    await page.goto("/admin/articles/new")
    await page.getByLabel(/slug/i).fill("permanent-delete-fixture")
    await expect(page.getByText(/занят|reserved/i)).toBeVisible()
    await page.goto("/admin/users/last-owner-fixture")
    await expect(page.getByRole("button", { name: /удалить навсегда|delete permanently/i })).toHaveCount(0)
  })
})
