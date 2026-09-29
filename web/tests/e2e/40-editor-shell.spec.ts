import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "./helpers/test"
import { uniqueEmail, withPrisma } from "./helpers/auth-fixtures"
import { createSessionId, signAccessToken } from "./helpers/session-token"
import { SESSION_ACCESS_COOKIE } from "../../shared/session"

/**
 * T-040: обвязка редактора `/me/articles/{id}/edit`
 * (`docs/spec/30-account/author/article-edit.md`).
 *
 * Критерий 1 — сохранение с устаревшей базовой ревизией отвечает `CONFLICT`, и редактор
 * показывает баннер с двумя выходами (ADR-0033). Сценарий идёт настоящим путём: две вкладки,
 * настоящий API, настоящая запись в базе.
 *
 * Критерий 3 — каждая строка состояний §8 воспроизводима на странице.
 */

const suffix = () => Math.random().toString(16).slice(2, 10)

const CONTENT_SCHEMA_VERSION = 1
const document = (text: string) => ({
  type: "doc",
  attrs: { schemaVersion: CONTENT_SCHEMA_VERSION },
  content: [
    {
      type: "paragraph",
      attrs: { id: "0b7e4c1a-3f2d-4c8e-9a1b-2c3d4e5f6a7b" },
      ...(text ? { content: [{ type: "text", text }] } : {})
    }
  ]
})

interface Fixture {
  userId: string
  sessionId: string
  translationId: string
  articleId: string
}

interface DraftOptions {
  /** Истёкший план даёт режим чтения с баннером (журнал #55). */
  planUntil?: Date | null
  archivedAccount?: boolean
  archivedArticle?: boolean
  status?: "draft" | "ai_check" | "review" | "published"
  rejected?: boolean
  /** Версия без единой ревизии — сломанная запись: страница показывает строку «Ошибка данных». */
  withoutRevisions?: boolean
  title?: string
  text?: string
  withCover?: boolean
}

/** Автор, рубрика и черновик с языковой версией — так же, как их заводит кабинет. */
const createDraft = async (options: DraftOptions = {}): Promise<Fixture> =>
  withPrisma(async (prisma) => {
    const key = suffix()
    const handle = `t040-${key}`
    await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail("t040"),
        handle,
        name: "Пётр Соколов",
        role: "author",
        planTier: "standard",
        planUntil: options.planUntil === undefined ? new Date("2099-01-01T00:00:00.000Z") : options.planUntil,
        ...(options.archivedAccount ? { archivedAt: new Date(), archiveMode: "self" as const } : {})
      }
    })
    await prisma.handleHistory.update({ where: { handle }, data: { userId: user.id } })

    // Реестр слагов рубрик append-only (ADR-0004): запись заводится до самой рубрики.
    const sectionSlug = `t040-section-${key}`
    await prisma.sectionSlugHistory.upsert({ where: { slug: sectionSlug }, update: {}, create: { slug: sectionSlug } })
    const section = await prisma.section.create({
      data: { slug: sectionSlug, name: `Рубрика ${key}`, nameEn: `Section ${key}`, status: "active", order: 100 }
    })
    await prisma.sectionSlugHistory.update({ where: { slug: sectionSlug }, data: { ownerSectionId: section.id } })

    // Языковую версию заводит trigger `t015_sync_legacy_article`: создавать её вложенно значило
    // бы упереться в уникальность `(articleId, locale)`.
    const article = await prisma.article.create({
      data: {
        title: options.title ?? "",
        slug: `t040-article-${key}`,
        body: "",
        status: "draft",
        sourceLocale: "ru",
        authorId: user.id,
        sectionId: section.id
      }
    })
    const translation = await prisma.articleTranslation.findFirstOrThrow({ where: { articleId: article.id } })

    await prisma.articleTranslation.update({
      where: { id: translation.id },
      data: {
        title: options.title ?? "",
        body: document(options.text ?? ""),
        status: options.status ?? "draft",
        rejected: options.rejected ?? false
      }
    })
    await prisma.articleRevision.updateMany({
      where: { translationId: translation.id },
      data: { title: options.title ?? "", body: document(options.text ?? "") }
    })

    if (options.withCover) {
      // Ключи объектов разбираются по формату `{год}/{месяц}/{id}/w{ширина}.{формат}`
      // (`server/src/storage/keys.ts`): публичный адрес выдаётся только варианту.
      const assetId = randomUUID()
      const asset = await prisma.mediaAsset.create({
        data: {
          id: assetId,
          ownerId: user.id,
          kind: "image",
          mimeType: "image/webp",
          byteSize: 1024,
          storageKey: `2026/09/${assetId}.webp`,
          sha256: `t040-${key}`,
          focalX: 0.5,
          focalY: 0.5,
          processingStatus: "ready",
          license: "own",
          attribution: "Пётр Соколов",
          alt: "Вид на залив",
          variants: {
            version: 1,
            placeholder: null,
            thumbnailWidth: 480,
            focal: { x: 0.5, y: 0.5 },
            items: [
              { format: "webp", width: 960, height: 640, key: `2026/09/${assetId}/w960.webp`, byteSize: 10 },
              {
                format: "webp",
                width: 960,
                height: 480,
                key: `2026/09/${assetId}/lede-w960.webp`,
                byteSize: 10,
                crop: "lede"
              }
            ]
          }
        }
      })
      await prisma.article.update({ where: { id: article.id }, data: { coverAssetId: asset.id } })
    }

    if (options.withoutRevisions) {
      await prisma.articleRevision.deleteMany({ where: { translationId: translation.id } })
    }

    if (options.archivedArticle) {
      await prisma.article.update({
        where: { id: article.id },
        data: { status: "archived", archivedAt: new Date(), archivedByActorId: user.id, archivedByRole: "author" }
      })
    }

    const sessionId = await createSessionId(prisma, user.id)
    return { userId: user.id, sessionId, translationId: translation.id, articleId: article.id }
  })

/** Сессия кладётся в ту же httpOnly-cookie, что ставит BFF после входа (ADR-0023 п. 2). */
const authenticate = async (page: Page, fixture: Fixture): Promise<void> => {
  await page.context().addCookies([
    {
      name: SESSION_ACCESS_COOKIE,
      value: signAccessToken(fixture.userId, fixture.sessionId),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }
  ])
}

const editorPath = (fixture: Fixture) => `/me/articles/${fixture.translationId}/edit`

test.describe("T-040 обвязка редактора", () => {
  test("критерий 1: правка во второй вкладке даёт CONFLICT и баннер с двумя выходами", async ({ browser }) => {
    const fixture = await createDraft({ title: "Исходный заголовок", text: "Исходный текст" })
    const context = await browser.newContext()
    const first = await context.newPage()
    const second = await context.newPage()
    await authenticate(first, fixture)

    await first.goto(editorPath(fixture))
    await second.goto(editorPath(fixture))
    await expect(first.getByTestId("editor-title")).toHaveValue("Исходный заголовок")
    await expect(second.getByTestId("editor-title")).toHaveValue("Исходный заголовок")

    // Первая вкладка сохраняет свою правку: базовая ревизия версии становится новой.
    await first.getByTestId("editor-title").fill("Заголовок первой вкладки")
    await first.getByTestId("editor-save").click()
    await expect(first.getByTestId("editor-save-state")).toHaveText("Сохранено")

    // Вторая держит прежнюю базовую ревизию, и её сохранение упирается в конфликт.
    await second.getByTestId("editor-title").fill("Заголовок второй вкладки")
    await second.getByTestId("editor-save").click()
    await expect(second.getByTestId("editor-conflict")).toBeVisible()
    await expect(second.getByTestId("editor-save-state")).toHaveText("Версия изменилась в другой вкладке")

    // «Открыть свежую» показывает то, что сохранила первая вкладка.
    await second.getByTestId("editor-conflict-fresh").click()
    await expect(second.getByTestId("editor-title")).toHaveValue("Заголовок первой вкладки")
    await expect(second.getByTestId("editor-conflict")).toBeHidden()

    // «Сохранить копию как ревизию» кладёт свой текст поверх свежей базовой ревизии.
    await first.getByTestId("editor-title").fill("Заголовок после конфликта")
    await first.getByTestId("editor-save").click()
    await expect(first.getByTestId("editor-save-state")).toHaveText("Сохранено")

    await second.getByTestId("editor-title").fill("Текст второй вкладки сохранён копией")
    await second.getByTestId("editor-save").click()
    await expect(second.getByTestId("editor-conflict")).toBeVisible()
    await second.getByTestId("editor-conflict-copy").click()
    await expect(second.getByTestId("editor-save-state")).toHaveText("Сохранено")

    const saved = await withPrisma((prisma) =>
      prisma.articleTranslation.findUniqueOrThrow({ where: { id: fixture.translationId }, select: { title: true } })
    )
    expect(saved.title).toBe("Текст второй вкладки сохранён копией")

    await context.close()
  })

  test("критерий 3, строка «Пусто»: новый черновик не отправляется без обязательных полей", async ({ page }) => {
    const fixture = await createDraft()
    await authenticate(page, fixture)

    await page.goto(editorPath(fixture))

    await expect(page.getByTestId("editor-title")).toHaveValue("")
    await expect(page.getByTestId("editor-cover-placeholder")).toBeVisible()
    await expect(page.getByTestId("editor-submit")).toBeDisabled()
    // Перечень недостающего называется до нажатия, а не после отказа.
    await expect(page.getByTestId("editor-missing")).toContainText("Заголовок")
    await expect(page.getByTestId("editor-missing")).toContainText("Обложка")
  })

  test("критерий 3, строка «Загрузка»: до ответа показан скелет редактора", async ({ page }) => {
    const fixture = await createDraft({ title: "Материал", text: "Текст" })
    await authenticate(page, fixture)

    // Переход внутри приложения: на первом ответе сервер ждёт данные сам, и скелет в разметку
    // не попадает — он показывается именно при переходе из кабинета.
    await page.goto("/me/articles")
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route("**/api/graphql", async (route) => {
      const body = route.request().postDataJSON() as { query?: string }
      if (body.query?.includes("GetEditorTranslation")) await held
      await route.continue()
    })

    await page.getByRole("link", { name: "Редактировать" }).first().click()
    await expect(page.getByTestId("editor-loading")).toBeVisible()
    release()
    await expect(page.getByTestId("editor-title")).toHaveValue("Материал")
  })

  test("критерий 3, строка «Ошибка данных»: версия не получена — ответ 500", async ({ page }) => {
    // Версия без единой ревизии: API отвечает `INTERNAL_ERROR`, и страница отдаёт 500, а не
    // пустой скелет с кодом 200.
    const fixture = await createDraft({ withoutRevisions: true, title: "Сломанная запись" })
    await authenticate(page, fixture)

    const response = await page.goto(editorPath(fixture), { waitUntil: "commit" })

    expect(response?.status()).toBe(500)
  })

  test("критерий 3, строка «Нет доступа»: гость уходит на вход с путём возврата", async ({ page }) => {
    const fixture = await createDraft()

    await page.goto(editorPath(fixture))

    await expect(page).toHaveURL(
      (url) => url.pathname === "/login" && url.searchParams.get("next") === editorPath(fixture)
    )
  })

  test("критерий 3, строка «Не найдено»: чужая и неизвестная версия отвечают 404", async ({ page }) => {
    const mine = await createDraft()
    const stranger = await createDraft()
    await authenticate(page, mine)

    const unknown = await page.goto("/me/articles/00000000-0000-4000-8000-000000000000/edit", {
      waitUntil: "commit"
    })
    expect(unknown?.status()).toBe(404)

    // Чужая версия отвечает так же: её существование наружу не подтверждается.
    const foreign = await page.goto(editorPath(stranger), { waitUntil: "commit" })
    expect(foreign?.status()).toBe(404)
  })

  test("критерий 3, строка «Ограничение плана»: истёкшая подписка даёт чтение и ссылку на тарифы", async ({ page }) => {
    const fixture = await createDraft({
      planUntil: new Date("2020-01-01T00:00:00.000Z"),
      title: "Материал бывшего автора",
      text: "Текст"
    })
    await authenticate(page, fixture)

    await page.goto(editorPath(fixture))

    await expect(page.getByTestId("editor-notice-plan")).toBeVisible()
    await expect(page.getByTestId("editor-notice-plan").getByRole("link")).toHaveAttribute("href", "/pricing")
    await expect(page.getByTestId("editor-title")).toHaveAttribute("readonly", "")
    await expect(page.getByTestId("editor-save")).toHaveCount(0)
    await expect(page.getByTestId("editor-submit")).toHaveCount(0)
  })

  test("критерий 3, строка «Заблокирован»: ограниченная сессия уходит на состояние архива", async ({ page }) => {
    const fixture = await createDraft({ archivedAccount: true })
    await authenticate(page, fixture)

    await page.goto(editorPath(fixture))

    await expect(page).toHaveURL(/\/me\/archived$/)
  })

  test("критерий 3, строка «Заблокирован»: материал в архиве открыт только на чтение", async ({ page }) => {
    const fixture = await createDraft({ archivedArticle: true, title: "Архивный материал", text: "Текст" })
    await authenticate(page, fixture)

    await page.goto(editorPath(fixture))

    await expect(page.getByTestId("editor-notice-archived")).toBeVisible()
    await expect(page.getByTestId("editor-title")).toHaveAttribute("readonly", "")
    await expect(page.getByTestId("editor-add-block")).toHaveCount(0)
  })

  test("критерий 3, строка «Paywall»: признака платного материала в редакторе нет", async ({ page }) => {
    const fixture = await createDraft({ title: "Материал", text: "Текст" })
    await authenticate(page, fixture)

    await page.goto(`${editorPath(fixture)}?tab=seo`)

    // Состояние зарезервировано и не наступает никогда: чтение бесплатно (ADR-0036, §8).
    await expect(page.getByTestId("editor-panel-seo")).toBeVisible()
    await expect(page.getByTestId("editor-paywall")).toHaveCount(0)
    await expect(page.getByText(/paywall|платн/i)).toHaveCount(0)
  })

  test("отклонённая редакцией версия открыта на чтение, ai_check и проверка — тоже", async ({ page }) => {
    const rejected = await createDraft({ rejected: true, title: "Отклонённый материал", text: "Текст" })
    await authenticate(page, rejected)
    await page.goto(editorPath(rejected))
    await expect(page.getByTestId("editor-notice-rejected")).toBeVisible()
    await expect(page.getByTestId("editor-title")).toHaveAttribute("readonly", "")

    const checking = await createDraft({ status: "ai_check", title: "Проверяемый материал", text: "Текст" })
    await authenticate(page, checking)
    await page.goto(editorPath(checking))
    await expect(page.getByTestId("editor-notice-ai-check")).toBeVisible()
    // Из проверки версию можно только отозвать (§7).
    await expect(page.getByTestId("editor-withdraw")).toBeVisible()
  })

  test("подача с обложкой и рубрикой переводит версию в AI-проверку и открывает отзыв", async ({ page }) => {
    const fixture = await createDraft({ title: "Готовый материал", text: "Текст материала", withCover: true })
    await authenticate(page, fixture)

    await page.goto(editorPath(fixture))

    await expect(page.getByTestId("editor-missing")).toHaveCount(0)
    await page.getByTestId("editor-submit").click()

    await expect(page.getByTestId("editor-status")).toHaveText("Проверяется")
    await expect(page.getByTestId("editor-withdraw")).toBeVisible()
    await expect(page.getByTestId("editor-notice-ai-check")).toBeVisible()
  })
})
