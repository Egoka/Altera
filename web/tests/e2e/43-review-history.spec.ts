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

  const reviewerHandle = `t043-reviewer-${key}`
  await database.handleHistory.create({ data: { handle: reviewerHandle } })
  const reviewer = await database.user.create({
    data: {
      email: uniqueEmail("t043-reviewer"),
      handle: reviewerHandle,
      name: "Рецензент",
      role: "moderator"
    }
  })
  await database.handleHistory.update({ where: { handle: reviewerHandle }, data: { userId: reviewer.id } })
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

test("client navigation exposes loading and recoverable data-error states", async ({ page, database }) => {
  const key = suffix()
  const handle = `t043-state-${key}`
  await database.handleHistory.create({ data: { handle } })
  const author = await database.user.create({
    data: {
      email: uniqueEmail("t043-state"),
      handle,
      name: "Мария Соколова",
      role: "author",
      planTier: "standard",
      planUntil: new Date("2099-01-01T00:00:00.000Z")
    }
  })
  await database.handleHistory.update({ where: { handle }, data: { userId: author.id } })
  const article = await database.article.create({
    data: {
      title: "Состояния истории",
      slug: `t043-state-${key}`,
      body: "",
      status: "review",
      sourceLocale: "ru",
      authorId: author.id
    }
  })
  const translation = await database.articleTranslation.findFirstOrThrow({ where: { articleId: article.id } })
  await database.articleTranslation.update({ where: { id: translation.id }, data: { status: "rework" } })
  const sessionId = await createSessionId(database, author.id)
  await authenticate(page, author.id, sessionId)
  await page.goto("/me/articles")

  let releaseRequest!: () => void
  const blockedRequest = new Promise<void>((resolve) => {
    releaseRequest = resolve
  })
  await page.route("**/api/graphql", async (route) => {
    const body = route.request().postData() ?? ""
    if (!body.includes("GetTranslationReview")) return route.continue()
    await blockedRequest
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: null,
        errors: [{ message: "Internal server error", extensions: { code: "INTERNAL_ERROR", requestId: "t043" } }]
      })
    })
  })

  const navigation = page.getByRole("link", { name: "История проверки" }).click()
  await expect(page.locator("[data-review-state='loading']")).toBeVisible()
  releaseRequest()
  await navigation
  await expect(page.locator("[data-review-state='error']")).toBeVisible()
  await expect(page.getByRole("heading", { name: "История не загрузилась" })).toBeVisible()
})

test("empty, plan-limited, not-found, blocked and unauthenticated states stay reproducible", async ({
  page,
  database
}) => {
  const key = suffix()
  const handle = `t043-access-${key}`
  await database.handleHistory.create({ data: { handle } })
  const author = await database.user.create({
    data: {
      email: uniqueEmail("t043-access"),
      handle,
      name: "Павел Ветров",
      role: "author",
      planTier: "standard",
      planUntil: new Date("2099-01-01T00:00:00.000Z")
    }
  })
  await database.handleHistory.update({ where: { handle }, data: { userId: author.id } })
  const article = await database.article.create({
    data: {
      title: "Новый черновик",
      slug: `t043-access-${key}`,
      body: "",
      status: "draft",
      sourceLocale: "ru",
      authorId: author.id
    }
  })
  const translation = await database.articleTranslation.findFirstOrThrow({ where: { articleId: article.id } })
  const sessionId = await createSessionId(database, author.id)
  await authenticate(page, author.id, sessionId)

  await page.goto(`/me/articles/${translation.id}/review`)
  await expect(page.locator("[data-review-state='empty']")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Проверок ещё не было" })).toBeVisible()

  await database.user.update({
    where: { id: author.id },
    data: { role: "reader", planTier: "free", planUntil: null }
  })
  await page.reload()
  await expect(page.getByText("План неактивен: история доступна, а повторная подача закрыта.")).toBeVisible()
  await expect(page.getByRole("link", { name: "Открыть для чтения и копирования" })).toBeVisible()

  const missing = await page.goto(`/me/articles/00000000-0000-4000-8000-000000000043/review`)
  expect(missing?.status()).toBe(404)

  await database.user.update({ where: { id: author.id }, data: { archivedAt: new Date() } })
  await page.goto(`/me/articles/${translation.id}/review`)
  await expect(page).toHaveURL(/\/me\/archived$/)

  await page.context().clearCookies()
  await page.goto(`/me/articles/${translation.id}/review`)
  await expect(page).toHaveURL(/\/login\?next=/)
})
