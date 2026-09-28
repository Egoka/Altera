import { readFile } from "node:fs/promises"
import { expect, test, type APIRequestContext } from "./helpers/test"
import { uniqueEmail, withPrisma } from "./helpers/auth-fixtures"
import { createSessionId, signAccessToken } from "./helpers/session-token"

/**
 * T-065, критерий 1: после загрузки новый аватар виден гостю без ожидания проверки
 * (`docs/spec/85-media-and-binary/avatars.md` п. 4, журнал §29.5).
 *
 * Сценарий идёт по настоящему пути: файл уходит в API multipart-запросом, конвейер делает
 * квадратные варианты, а гость без сессии открывает публичную страницу автора и получает тот же
 * файл из раздачи `/media`. Ни рецензент, ни фоновая задача в сценарии не участвуют — в этом и
 * состоит проверяемое правило. Откат рецензентом и права проверяются тестами сервера
 * (`server/tests/account-avatar.test.ts`): очереди проверки профилей в интерфейсе ещё нет.
 */

const apiUrl = process.env.T065_API_URL ?? "http://127.0.0.1:4000/"

/** Исходник 900×600 лежит файлом: `sharp` — зависимость сервера, в рабочем пространстве веба её нет. */
const sourceImage = () => readFile(new URL("fixtures/avatar-source.jpg", import.meta.url))

interface Author {
  id: string
  handle: string
  token: string
}

const createPublishedAuthor = async (): Promise<Author> =>
  withPrisma(async (prisma) => {
    const handle = `t065-${Math.random().toString(16).slice(2, 10)}`
    await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
    const user = await prisma.user.create({
      data: { email: uniqueEmail("t065"), handle, name: "Вера Орлова", role: "author" }
    })
    await prisma.handleHistory.update({ where: { handle }, data: { userId: user.id } })

    // Публичная страница есть только у аккаунта хотя бы с одной опубликованной статьёй
    // (`20-public/author.md` §1).
    await prisma.article.create({
      data: {
        title: "T065 материал",
        slug: `t065-${Math.random().toString(16).slice(2, 10)}`,
        body: "",
        status: "published",
        publishedAt: new Date(),
        firstPublishedAt: new Date(),
        authorId: user.id
      }
    })

    const sessionId = await createSessionId(prisma, user.id)
    return { id: user.id, handle, token: signAccessToken(user.id, sessionId) }
  })

const UPLOAD_AVATAR = `
  mutation UploadAvatar($file: File!, $crop: AvatarCropInput) {
    uploadAvatar(file: $file, crop: $crop) {
      assetId
      url
    }
  }
`

/**
 * Загрузка multipart-запросом GraphQL — тем же путём, которым файл придёт из браузера.
 * Заголовок `x-graphql-yoga-csrf` требует защита от межсайтовых запросов: без него Yoga
 * отклоняет `multipart/form-data` (`useCSRFPrevention`).
 */
const uploadAvatar = async (
  request: APIRequestContext,
  author: Author,
  crop?: { x: number; y: number; size: number }
): Promise<{ assetId: string; url: string }> => {
  const response = await request.post(apiUrl, {
    headers: { authorization: `Bearer ${author.token}`, "x-graphql-yoga-csrf": "1" },
    multipart: {
      operations: JSON.stringify({ query: UPLOAD_AVATAR, variables: { file: null, crop: crop ?? null } }),
      map: JSON.stringify({ "0": ["variables.file"] }),
      "0": { name: "avatar.jpg", mimeType: "image/jpeg", buffer: await sourceImage() }
    }
  })

  expect(response.status(), await response.text()).toBe(200)
  const body = (await response.json()) as {
    data?: { uploadAvatar: { assetId: string; url: string } | null }
    errors?: { message: string }[]
  }
  expect(body.errors, JSON.stringify(body.errors)).toBeUndefined()
  expect(body.data?.uploadAvatar).not.toBeNull()
  return body.data!.uploadAvatar!
}

test.describe("T-065 аватар", () => {
  test("гость видит новый аватар автора сразу после загрузки", async ({ page, request }) => {
    const author = await createPublishedAuthor()
    const uploaded = await uploadAvatar(request, author, { x: 150, y: 0, size: 600 })

    // Гость: тот же браузер без cookie автора.
    await page.context().clearCookies()
    await page.goto(`/authors/${author.handle}`)

    const avatar = page.getByTestId("author-avatar")
    await expect(avatar).toBeVisible()
    await expect(avatar).toHaveAttribute("src", new RegExp(`${uploaded.assetId}/w\\d+\\.webp$`))

    // Файл действительно публичен: раздача отдаёт его без подписи и без решения рецензента.
    const served = await request.get(uploaded.url)
    expect(served.status()).toBe(200)
    expect(served.headers()["content-type"]).toBe("image/webp")
  })

  test("после удаления аватара страница автора показывает инициалы", async ({ page, request }) => {
    const author = await createPublishedAuthor()
    await uploadAvatar(request, author)

    const removed = await request.post(apiUrl, {
      headers: { authorization: `Bearer ${author.token}`, "content-type": "application/json" },
      data: { query: "mutation RemoveAvatar { removeAvatar { assetId } }" }
    })
    expect(removed.status()).toBe(200)
    expect((await removed.json()).errors, await removed.text()).toBeUndefined()

    await page.context().clearCookies()
    await page.goto(`/authors/${author.handle}`)

    await expect(page.getByTestId("author-avatar")).toHaveCount(0)
    await expect(page.getByTestId("author-initials")).toHaveText("ВО")
  })
})
