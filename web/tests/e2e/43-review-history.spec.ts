import { expect, test, type Page } from "./helpers/test"
import { uniqueEmail } from "./helpers/auth-fixtures"
import { createSessionId, signAccessToken } from "./helpers/session-token"
import { SESSION_ACCESS_COOKIE } from "../../shared/session"

const suffix = () => Math.random().toString(16).slice(2, 10)

const document = (text: string) => ({
  type: "doc",
  attrs: { schemaVersion: 1 },
  content: [
    {
      type: "paragraph",
      attrs: { id: "43b7e4c1-3f2d-4c8e-9a1b-2c3d4e5f6a7b" },
      content: [{ type: "text", text }]
    }
  ]
})

const authenticate = async (page: Page, userId: string, sessionId: string) => {
  await page.context().addCookies([
    {
      name: SESSION_ACCESS_COOKIE,
      value: signAccessToken(userId, sessionId),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }
  ])
}

test("author replies inside a review decision and resolves its block note", async ({ page, database }) => {
  const key = suffix()
  const authorHandle = `t043-author-${key}`
  await database.handleHistory.create({ data: { handle: authorHandle } })
  const author = await database.user.create({
    data: {
      email: uniqueEmail("t043-author"),
      handle: authorHandle,
      name: "Анна Лебедева",
      role: "author",
      planTier: "standard",
      planUntil: new Date("2099-01-01T00:00:00.000Z")
    }
  })
  await database.handleHistory.update({ where: { handle: authorHandle }, data: { userId: author.id } })

  const reviewer = await database.user.create({
    data: { email: uniqueEmail("t043-reviewer"), name: "Рецензент", role: "moderator" }
  })
  const article = await database.article.create({
    data: {
      title: "Как устроен свет",
      slug: `t043-light-${key}`,
      body: "",
      status: "review",
      sourceLocale: "ru",
      authorId: author.id
    }
  })
  const translation = await database.articleTranslation.findFirstOrThrow({ where: { articleId: article.id } })
  const revision = await database.articleRevision.findFirstOrThrow({ where: { translationId: translation.id } })
  await database.articleTranslation.update({
    where: { id: translation.id },
    data: { title: "Как устроен свет", body: document("Основной текст"), status: "rework" }
  })
  const decision = await database.reviewMessage.create({
    data: {
      translationId: translation.id,
      kind: "rework_request",
      text: "Нужна фактическая опора",
      recommendations: "Добавьте ссылку на первичный источник",
      byRole: "moderator"
    }
  })
  const note = await database.reviewNote.create({
    data: {
      revisionId: revision.id,
      blockId: "43b7e4c1-3f2d-4c8e-9a1b-2c3d4e5f6a7b",
      text: "Уточните источник даты",
      createdById: reviewer.id
    }
  })
  const sessionId = await createSessionId(database, author.id)
  await authenticate(page, author.id, sessionId)

  await page.goto(`/me/articles/${translation.id}/review`)
  await expect(page.getByRole("heading", { name: "Как устроен свет" })).toBeVisible()
  await expect(page.getByText("Добавьте ссылку на первичный источник")).toBeVisible()
  await expect(page.getByText("Уточните источник даты")).toBeVisible()

  await page.getByLabel("Ответить рецензенту").fill("Источник добавлен в третий блок")
  await page.getByRole("button", { name: "Отправить ответ" }).click()
  await expect(page.getByText("Источник добавлен в третий блок")).toBeVisible()

  await expect
    .poll(async () =>
      database.reviewMessage.count({
        where: {
          translationId: translation.id,
          parentId: decision.id,
          kind: "author_reply",
          text: "Источник добавлен в третий блок"
        }
      })
    )
    .toBe(1)

  await page.getByRole("button", { name: "Отметить решённым" }).click()
  await expect(page.getByText("Решено", { exact: true })).toBeVisible()
  await expect.poll(async () => (await database.reviewNote.findUnique({ where: { id: note.id } }))?.resolved).toBe(true)
})

test("final rejection keeps the review page readable and closes the thread", async ({ page, database }) => {
  const key = suffix()
  const handle = `t043-final-${key}`
  await database.handleHistory.create({ data: { handle } })
  const author = await database.user.create({
    data: {
      email: uniqueEmail("t043-final"),
      handle,
      name: "Илья Орлов",
      role: "author",
      planTier: "standard",
      planUntil: new Date("2099-01-01T00:00:00.000Z")
    }
  })
  await database.handleHistory.update({ where: { handle }, data: { userId: author.id } })
  const article = await database.article.create({
    data: {
      title: "Окончательное решение",
      slug: `t043-final-${key}`,
      body: "",
      status: "review",
      sourceLocale: "ru",
      authorId: author.id
    }
  })
  const translation = await database.articleTranslation.findFirstOrThrow({ where: { articleId: article.id } })
  await database.articleTranslation.update({
    where: { id: translation.id },
    data: { title: "Окончательное решение", body: document("Текст остаётся автору"), rejected: true }
  })
  await database.reviewMessage.create({
    data: {
      translationId: translation.id,
      kind: "final_reject",
      text: "Редакционное решение окончательное",
      byRole: "moderator"
    }
  })
  const sessionId = await createSessionId(database, author.id)
  await authenticate(page, author.id, sessionId)

  await page.goto(`/me/articles/${translation.id}/review`)

  await expect(
    page.getByText("Решение редакции окончательное. Материал доступен для чтения и копирования.")
  ).toBeVisible()
  await expect(page.getByText("Редакционное решение окончательное")).toBeVisible()
  await expect(page.getByRole("link", { name: "Исправить материал" })).toHaveCount(0)
  await expect(page.getByRole("textbox", { name: "Ответить рецензенту" })).toHaveCount(0)
})
