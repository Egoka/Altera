import { expect, test } from "./helpers/test"

/**
 * T-122, журнал §41: правка опубликованной статьи идёт копией через AI-проверку — публичной
 * остаётся прежняя версия. Критерии (`docs/backlog/tasks/T-122-edit-published-via-check.md` §5)
 * проверены серверными наборами `server/tests/translation-editor.test.ts`
 * (`describe("T-122 правка опубликованной статьи через проверку")`) и
 * `server/tests/ai-check-adapter.test.ts` (`describe("T-122 ...")`) — полный цикл через настоящий
 * сервер здесь не разворачивается до редактора опубликованной статьи в интерфейсе (ADR веб-части
 * не входит в объём T-122: кнопка «править» для `published` не добавлялась).
 */

test("flow #122 правит опубликованную статью в копии и не меняет читателю видимую версию", async ({ page }) => {
  test.skip(true, "Веб-интерфейс правки published-версии не входит в объём T-122 (см. API-уровень в server/tests)")

  await test.step("критерий 1: пока копия на AI-проверке, читатель видит прежнюю версию", async () => {
    await page.goto("/t122-section/t122-article")
    await expect(page.getByRole("heading", { name: "Исходный опубликованный текст" })).toBeVisible()
  })

  await test.step("критерий 2: отказ AI оставляет прежнюю версию и уходит в ручную ветку ревьюера", async () => {
    await page.goto("/me/articles/t122-translation-id/edit")
    await expect(page.getByText(/ручн.*проверк|manual review/i)).toBeVisible()
    await page.goto("/t122-section/t122-article")
    await expect(page.getByRole("heading", { name: "Исходный опубликованный текст" })).toBeVisible()
  })

  await test.step("критерий 3: вторую правку нельзя подать, пока первая на проверке", async () => {
    await page.goto("/me/articles/t122-translation-id/edit")
    await expect(page.getByTestId("editor-submit")).toBeDisabled()
  })
})
