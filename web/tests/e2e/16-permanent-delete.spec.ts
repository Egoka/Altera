import { expect, test } from "./helpers/test"

test("flow #16 permanently deletes only an archived entity after exact confirmation", async ({ page }) => {
  test.skip(
    true,
    "Requires T-076 plus role, archive, relation-conflict, and reservation fixtures; destructive flow must run only against its isolated fixture environment"
  )

  await test.step("Шаг 1: открыть усиленный диалог удаления архивированной сущности только для owner", async () => {
    await page.goto("/auth/fixture-login?role=admin")
    await page.goto("/admin/articles/archived-permanent-delete-fixture")
    await expect(page.getByRole("button", { name: /удалить навсегда|delete permanently/i })).toHaveCount(0)

    await page.goto("/auth/fixture-login?role=owner")
    await page.goto("/admin/articles/active-permanent-delete-fixture")
    await expect(page.getByText(/published|опубликован/i)).toBeVisible()
    await expect(page.getByRole("button", { name: /удалить навсегда|delete permanently/i })).toHaveCount(0)

    await page.goto("/admin/articles/permanent-delete-fixture")
    await expect(page.getByText(/archived|архив/i)).toBeVisible()
    await page.getByRole("button", { name: /удалить навсегда|delete permanently/i }).click()
    await expect(page.getByText(/верс|медиа|аудит|version|media|audit/i)).toBeVisible()
  })

  await test.step("Шаг 2: ввести точное имя и причину, затем удалить сущность транзакционно", async () => {
    await page.getByLabel(/точное имя|exact name/i).fill("wrong name")
    await page.getByLabel(/причин|reason/i).fill("Fixture cleanup")
    await page.getByRole("button", { name: /подтвердить|confirm/i }).click()
    await expect(page.getByText(/имя не совпадает|name does not match/i)).toBeVisible()
    await page.goto("/admin/categories/linked-category-fixture")
    await page.getByRole("button", { name: /удалить навсегда|delete permanently/i }).click()
    await expect(page.getByText(/связ.*материал|linked articles/i)).toBeVisible()

    await page.goto("/admin/users/last-owner-fixture")
    await page.getByRole("button", { name: /удалить навсегда|delete permanently/i }).click()
    await expect(page.getByText(/последн.*владел|last owner/i)).toBeVisible()

    await page.goto("/admin/articles/permanent-delete-fixture")
    await page.getByRole("button", { name: /удалить навсегда|delete permanently/i }).click()
    await page.getByLabel(/точное имя|exact name/i).fill("Permanent delete fixture")
    await page.getByRole("button", { name: /подтвердить|confirm/i }).click()
    const deletedResponse = await page.request.get("/permanent-delete-fixture")
    expect(deletedResponse.status()).toBe(404)
  })

  await test.step("Шаг 3: убедиться, что сущность исчезла, аудит остался, а адреса зарезервированы", async () => {
    await page.goto("/admin/audit")
    await expect(page.getByText(/entity\.delete\.permanent/i)).toBeVisible()

    await page.goto("/admin/articles/new")
    await page.getByLabel(/slug/i).fill("permanent-delete-fixture")
    await expect(page.getByText(/занят|reserved/i)).toBeVisible()

    await page.goto("/admin/users/new")
    await page.getByLabel(/хэндл|handle/i).fill("permanently-deleted-user")
    await expect(page.getByText(/занят|reserved/i)).toBeVisible()
  })
})
