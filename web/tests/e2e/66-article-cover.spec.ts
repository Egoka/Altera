import { readFile } from "node:fs/promises"
import { expect, test, type APIRequestContext } from "./helpers/test"
import { uniqueEmail, withPrisma } from "./helpers/auth-fixtures"
import { createSessionId, signAccessToken } from "./helpers/session-token"

/**
 * T-066, критерий 2: карточка ленты не показывает заполнитель для опубликованного материала —
 * у него своя обложка, дефолтных изображений в лентах нет (журнал §29.1,
 * `docs/spec/85-media-and-binary/article-covers.md` п. 4).
 *
 * Сценарий идёт по настоящему пути: файл уходит в API multipart-запросом, конвейер делает
 * мастер и варианты, `setArticleCover` кадрирует обложку по фокусной точке, и гость без сессии
 * открывает ленту рубрики, где карточка показывает вырезанный кадр из раздачи `/media`.
 */

const apiUrl = process.env.T066_API_URL ?? "http://127.0.0.1:4000/"
const document = {
  type: "doc",
  attrs: { schemaVersion: 1 },
  content: [
    {
      type: "paragraph",
      attrs: { id: "0b7e4c1a-3f2d-4c8e-9a1b-2c3d4e5f6a7b" },
      content: [{ type: "text", text: "Текст материала" }]
    }
  ]
}

/** Исходник 1600×900 лежит файлом: `sharp` — зависимость сервера, в рабочем пространстве веба её нет. */
const sourceImage = () => readFile(new URL("fixtures/cover-source.jpg", import.meta.url))

interface Fixture {
  token: string
  articleId: string
  translationId: string
  articleSlug: string
  sectionSlug: string
  title: string
}

const suffix = () => Math.random().toString(16).slice(2, 10)

/** Автор с активным планом, своя рубрика и черновик с языковой версией — как их создаёт кабинет. */
const createDraft = async (): Promise<Fixture> =>
  withPrisma(async (prisma) => {
    const key = suffix()
    const handle = `t066-${key}`
    await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail("t066"),
        handle,
        name: "Пётр Соколов",
        role: "author",
        // Загрузка медиа версии статьи требует активного плана (матрица #39).
        planTier: "standard",
        planUntil: new Date("2099-01-01T00:00:00.000Z")
      }
    })
    await prisma.handleHistory.update({ where: { handle }, data: { userId: user.id } })

    // Своя рубрика на сценарий: лента `/{рубрика}` тогда показывает ровно один материал и не
    // зависит от фикстур соседних наборов. Реестр слагов рубрик никогда не чистится (ADR-0004),
    // поэтому запись в нём заводится до самой рубрики.
    const sectionSlug = `t066-section-${key}`
    await prisma.sectionSlugHistory.upsert({ where: { slug: sectionSlug }, update: {}, create: { slug: sectionSlug } })
    const section = await prisma.section.create({
      data: {
        slug: sectionSlug,
        name: `Рубрика ${key}`,
        nameEn: `Section ${key}`,
        status: "active",
        order: 100
      }
    })
    await prisma.sectionSlugHistory.update({ where: { slug: sectionSlug }, data: { ownerSectionId: section.id } })

    const title = `Материал с обложкой ${key}`
    const articleSlug = `t066-article-${key}`
    // Языковую версию заводит trigger `t015_sync_legacy_article`, пока API пишет в `articles`
    // (T-015): создавать её вложенно значило бы упереться в уникальность `(articleId, locale)`.
    const article = await prisma.article.create({
      data: {
        title,
        slug: articleSlug,
        body: "",
        status: "draft",
        sourceLocale: "ru",
        authorId: user.id,
        sectionId: section.id
      }
    })
    const translation = await prisma.articleTranslation.findFirstOrThrow({ where: { articleId: article.id } })
    await prisma.articleTranslation.update({ where: { id: translation.id }, data: { body: document } })
    await prisma.articleRevision.updateMany({ where: { translationId: translation.id }, data: { body: document } })

    const sessionId = await createSessionId(prisma, user.id)
    return {
      token: signAccessToken(user.id, sessionId),
      articleId: article.id,
      translationId: translation.id,
      articleSlug,
      sectionSlug: section.slug,
      title
    }
  })

const UPLOAD_MEDIA = `
  mutation UploadMedia($translationId: ID!, $file: File!) {
    uploadMedia(translationId: $translationId, file: $file, license: own, attribution: "Пётр Соколов") {
      id
      processingStatus
    }
  }
`

const SET_COVER = `
  mutation SetCover($articleId: ID!, $assetId: ID!, $focal: FocalPointInput) {
    setArticleCover(articleId: $articleId, assetId: $assetId, focal: $focal) {
      assetId
      url
      variants
    }
  }
`

const SUBMIT_TRANSLATION = `
  mutation SubmitTranslation($id: ID!) {
    submitTranslation(id: $id) { id status }
  }
`

const callApi = async (request: APIRequestContext, token: string, query: string, variables: object) => {
  const response = await request.post(apiUrl, {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    data: { query, variables }
  })
  expect(response.status(), await response.text()).toBe(200)
  return (await response.json()) as { data?: Record<string, unknown>; errors?: { extensions?: unknown }[] }
}

/**
 * Загрузка multipart-запросом GraphQL — тем же путём, которым файл придёт из браузера.
 * Заголовок `x-graphql-yoga-csrf` требует защита от межсайтовых запросов.
 */
const uploadCover = async (request: APIRequestContext, fixture: Fixture): Promise<string> => {
  const response = await request.post(apiUrl, {
    headers: { authorization: `Bearer ${fixture.token}`, "x-graphql-yoga-csrf": "1" },
    multipart: {
      operations: JSON.stringify({
        query: UPLOAD_MEDIA,
        variables: { translationId: fixture.translationId, file: null }
      }),
      map: JSON.stringify({ "0": ["variables.file"] }),
      "0": { name: "cover.jpg", mimeType: "image/jpeg", buffer: await sourceImage() }
    }
  })

  expect(response.status(), await response.text()).toBe(200)
  const body = (await response.json()) as {
    data?: { uploadMedia: { id: string } | null }
    errors?: { message: string }[]
  }
  expect(body.errors, JSON.stringify(body.errors)).toBeUndefined()
  return body.data!.uploadMedia!.id
}

/** Обработка идёт заданием очереди в том же процессе API: сценарий ждёт готовой записи. */
const waitForReady = async (assetId: string): Promise<void> => {
  await expect
    .poll(
      () =>
        withPrisma((prisma) =>
          prisma.mediaAsset
            .findUnique({ where: { id: assetId }, select: { processingStatus: true } })
            .then((asset) => asset?.processingStatus ?? "missing")
        ),
      { timeout: 30_000, message: "конвейер медиа не довёл обложку до готовой записи" }
    )
    .toBe("ready")
}

const publish = (articleId: string) =>
  withPrisma((prisma) =>
    prisma.article.update({
      where: { id: articleId },
      data: { status: "published", publishedAt: new Date(), firstPublishedAt: new Date() }
    })
  )

test.describe("T-066 обложка материала", () => {
  test("критерий 2: карточка ленты показывает обложку материала и не показывает заполнитель", async ({
    page,
    request
  }) => {
    const fixture = await createDraft()
    const assetId = await uploadCover(request, fixture)
    await waitForReady(assetId)

    // Фокус прижат к верху: кадр карточки берёт верхнюю половину исходника.
    const cover = await callApi(request, fixture.token, SET_COVER, {
      articleId: fixture.articleId,
      assetId,
      focal: { x: 0.5, y: 0 }
    })
    expect(cover.errors, JSON.stringify(cover.errors)).toBeUndefined()

    await publish(fixture.articleId)

    // Гость: тот же браузер без cookie автора.
    await page.context().clearCookies()
    await page.goto(`/${fixture.sectionSlug}`)

    const card = page.locator("article", { hasText: fixture.title }).first()
    await expect(card).toBeVisible()
    // Раскладка ленты выводит карточку в вариантах `large` и `small` — оба берут кадр `large`.
    const image = card.locator("img").first()
    await expect(image).toHaveAttribute("src", new RegExp(`${assetId}/large-w\\d+\\.webp$`))
    // Заполнителя в ленте нет ни у одной карточки: дефолтных изображений лента не показывает.
    await expect(page.locator("[data-cover-placeholder]")).toHaveCount(0)
    await expect(page.locator('img[src*="picsum.photos"], img[src*="placeholder"]')).toHaveCount(0)

    // Кадр действительно публичен: раздача отдаёт его гостю без подписи.
    const served = await request.get(new URL((await image.getAttribute("src"))!, "http://127.0.0.1:4000").toString())
    expect(served.status()).toBe(200)
    expect(served.headers()["content-type"]).toBe("image/webp")
  })

  test("критерий 1: подача без обложки отвечает VALIDATION_ERROR", async ({ request }) => {
    const fixture = await createDraft()

    const rejected = await callApi(request, fixture.token, SUBMIT_TRANSLATION, { id: fixture.translationId })

    // Поле `submitTranslation` не обнуляемо, поэтому отказ обнуляет весь `data` — важно, что
    // подача не прошла и ответ назвал поле и правило.
    expect(rejected.data?.submitTranslation ?? null).toBeNull()
    expect(rejected.errors?.[0]?.extensions).toMatchObject({
      code: "VALIDATION_ERROR",
      field: "cover",
      rule: "required"
    })

    // С обложкой та же подача проходит.
    const assetId = await uploadCover(request, fixture)
    await waitForReady(assetId)
    await callApi(request, fixture.token, SET_COVER, { articleId: fixture.articleId, assetId, focal: null })

    const accepted = await callApi(request, fixture.token, SUBMIT_TRANSLATION, { id: fixture.translationId })
    expect(accepted.errors, JSON.stringify(accepted.errors)).toBeUndefined()
    expect(accepted.data?.submitTranslation).toMatchObject({ status: "ai_check" })
  })
})
