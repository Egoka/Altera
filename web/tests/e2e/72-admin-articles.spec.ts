import { expect, test, type Page } from "./helpers/test"
import { PrismaClient, type ArticleStatus, type Role } from "../../../server/src/generated/prisma/index.js"
import { createSessionId, signAccessToken } from "./helpers/session-token"

const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const prisma = new PrismaClient({ datasourceUrl: databaseUrl })

const STAFF = {
  admin: { id: "t072-admin", handle: "t072-admin", role: "admin" as Role, sessionId: "" },
  owner: { id: "t072-owner", handle: "t072-owner", role: "owner" as Role, sessionId: "" }
}
const AUTHOR_ID = "t072-author"
const SECTION_ID = "t072-section"
const SECTION_SLUG = "t072-articles"
const COVER_ID = "t072-cover"

const fixtures = {
  draft: { slug: "t072-draft", title: "T072 черновик", status: "draft" as ArticleStatus, rejected: false, reads: 7 },
  review: {
    slug: "t072-review",
    title: "T072 на проверке",
    status: "review" as ArticleStatus,
    rejected: false,
    reads: 17
  },
  published: {
    slug: "t072-published",
    title: "T072 опубликована",
    status: "published" as ArticleStatus,
    rejected: false,
    reads: 321
  },
  rejected: {
    slug: "t072-rejected",
    title: "T072 отклонена",
    status: "review" as ArticleStatus,
    rejected: true,
    reads: 27
  },
  archived: {
    slug: "t072-archived",
    title: "T072 в архиве",
    status: "published" as ArticleStatus,
    rejected: false,
    reads: 37
  }
}

const document = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", attrs: { id: `block-${text.length}` }, content: [{ type: "text", text }] }]
})

const authorize = (page: Page, staff: (typeof STAFF)[keyof typeof STAFF]) =>
  page.setExtraHTTPHeaders({ authorization: `Bearer ${signAccessToken(staff.id, staff.sessionId)}` })

async function upsertUser(input: { id: string; handle: string; name: string; role: Role; service: boolean }) {
  await prisma.handleHistory.upsert({ where: { handle: input.handle }, update: {}, create: { handle: input.handle } })
  await prisma.user.upsert({
    where: { id: input.id },
    update: { archivedAt: null, role: input.role, isServiceAccount: input.service, name: input.name },
    create: {
      id: input.id,
      email: `${input.handle}@example.test`,
      handle: input.handle,
      name: input.name,
      role: input.role,
      isServiceAccount: input.service
    }
  })
  await prisma.handleHistory.update({ where: { handle: input.handle }, data: { userId: input.id } })
}

async function seedArticle(key: keyof typeof fixtures) {
  const fixture = fixtures[key]
  await prisma.article.deleteMany({ where: { slug: fixture.slug } })
  const article = await prisma.article.create({
    data: {
      title: fixture.title,
      slug: fixture.slug,
      dek: `Лид: ${fixture.title}`,
      body: `${fixture.title}. Legacy body.`,
      status: key === "archived" ? "archived" : fixture.status,
      sourceLocale: "ru",
      authorId: AUTHOR_ID,
      sectionId: SECTION_ID,
      coverAssetId: COVER_ID,
      firstPublishedAt: ["published", "archived"].includes(key) ? new Date("2026-09-20T10:00:00.000Z") : null,
      publishedAt: ["published", "archived"].includes(key) ? new Date("2026-09-20T10:00:00.000Z") : null,
      archivedAt: key === "archived" ? new Date("2026-09-29T10:00:00.000Z") : null,
      archivedByActorId: key === "archived" ? STAFF.admin.id : null,
      archivedByRole: key === "archived" ? "admin" : null,
      archiveReason: key === "archived" ? "T072 fixture archive" : null
    }
  })
  const translation = await prisma.articleTranslation.findFirstOrThrow({ where: { articleId: article.id } })
  await prisma.articleTranslation.update({
    where: { id: translation.id },
    data: {
      title: fixture.title,
      dek: `Лид: ${fixture.title}`,
      body: document(`Текст версии ${fixture.title}`),
      status: fixture.status,
      rejected: fixture.rejected,
      readCount: fixture.reads,
      publishedAt: ["published", "archived"].includes(key) ? new Date("2026-09-20T10:00:00.000Z") : null
    }
  })
  await prisma.articleRevision.updateMany({
    where: { translationId: translation.id },
    data: { title: fixture.title, body: document(`Текст версии ${fixture.title}`) }
  })
  if (key === "published") {
    await prisma.reviewMessage.create({
      data: {
        translationId: translation.id,
        kind: "manual_publish",
        text: "Решение T072",
        byRole: "moderator"
      }
    })
  }
  return { articleId: article.id, translationId: translation.id }
}

test.describe("раздел статей по версиям", () => {
  test.describe.configure({ mode: "serial" })
  const ids = new Map<keyof typeof fixtures, { articleId: string; translationId: string }>()

  test.beforeAll(async () => {
    await upsertUser({
      id: STAFF.admin.id,
      handle: STAFF.admin.handle,
      name: "T072 Admin",
      role: "admin",
      service: true
    })
    await upsertUser({
      id: STAFF.owner.id,
      handle: STAFF.owner.handle,
      name: "T072 Owner",
      role: "owner",
      service: true
    })
    await upsertUser({ id: AUTHOR_ID, handle: "t072-author", name: "Вера Орлова", role: "author", service: false })

    await prisma.sectionSlugHistory.upsert({
      where: { slug: SECTION_SLUG },
      update: {},
      create: { slug: SECTION_SLUG }
    })
    await prisma.section.upsert({
      where: { id: SECTION_ID },
      update: { slug: SECTION_SLUG, name: "T072 Статьи", nameEn: "T072 Articles", status: "active" },
      create: {
        id: SECTION_ID,
        slug: SECTION_SLUG,
        name: "T072 Статьи",
        nameEn: "T072 Articles",
        status: "active",
        order: 5072
      }
    })
    await prisma.sectionSlugHistory.update({ where: { slug: SECTION_SLUG }, data: { ownerSectionId: SECTION_ID } })
    await prisma.mediaAsset.upsert({
      where: { id: COVER_ID },
      update: { processingStatus: "ready", deletedAt: null, alt: "T072 обложка" },
      create: {
        id: COVER_ID,
        ownerId: AUTHOR_ID,
        storageKey: "2026/09/t072-cover.webp",
        mimeType: "image/webp",
        byteSize: 512,
        width: 960,
        height: 640,
        sha256: "t072-cover-sha256",
        variants: [],
        processingStatus: "ready",
        alt: "T072 обложка",
        attribution: "Вера Орлова",
        license: "own"
      }
    })

    for (const key of Object.keys(fixtures) as Array<keyof typeof fixtures>) ids.set(key, await seedArticle(key))

    for (const staff of Object.values(STAFF)) {
      await prisma.session.deleteMany({ where: { userId: staff.id } })
      staff.sessionId = await createSessionId(prisma, staff.id)
    }
  })

  test.afterAll(async () => {
    await prisma.article.deleteMany({ where: { slug: { in: Object.values(fixtures).map(({ slug }) => slug) } } })
    await prisma.$disconnect()
  })

  for (const [tab, key] of [
    ["draft", "draft"],
    ["review", "review"],
    ["published", "published"],
    ["rejected", "rejected"],
    ["archived", "archived"]
  ] as const) {
    test(`показывает строку ${tab} с точным числом прочтений`, async ({ page }) => {
      await authorize(page, STAFF.admin)
      await page.goto(`/admin/articles?status=${tab}&q=t072`)
      const link = page.locator(`a[href="/admin/articles/${ids.get(key)!.translationId}"]`)
      const row = link.locator("xpath=ancestor::tr")
      await expect(link).toContainText(fixtures[key].title)
      await expect(row.locator("[data-article-reads]")).toHaveText(String(fixtures[key].reads))
    })
  }

  test("карточка остаётся read-only и показывает лид, обложку, ревизию и решение", async ({ page }) => {
    await authorize(page, STAFF.admin)
    await page.goto(`/admin/articles/${ids.get("published")!.translationId}`)

    await expect(page.locator("[data-article-lead]")).toContainText(fixtures.published.title)
    await expect(page.locator("[data-article-cover]")).toContainText("T072 обложка")
    await expect(page.locator("[data-article-body]")).toContainText(`Текст версии ${fixtures.published.title}`)
    await expect(page.locator("[data-article-revision]")).toHaveCount(1)
    await expect(page.locator("[data-article-decision]")).toContainText("Решение T072")
    await expect(page.locator("textarea[data-article-body]")).toHaveCount(0)
  })

  test("admin не может восстановить архив ни в UI, ни прямой мутацией", async ({ page }) => {
    const archived = ids.get("archived")!
    await authorize(page, STAFF.admin)
    await page.goto(`/admin/articles/${archived.translationId}`)
    await expect(page.locator("[data-article-archive]")).toContainText("admin")
    await expect(page.locator('[data-article-action="restore"]')).toHaveCount(0)

    const response = await page.request.post("/api/graphql", {
      headers: { authorization: `Bearer ${signAccessToken(STAFF.admin.id, STAFF.admin.sessionId)}` },
      data: {
        query: `mutation Restore($id: ID!) { restoreArticle(id: $id) { id status } }`,
        variables: { id: archived.articleId }
      }
    })
    expect(await response.json()).toMatchObject({ errors: [{ extensions: { code: "FORBIDDEN" } }] })
  })

  test("admin архивирует с причиной, а owner восстанавливает", async ({ page }) => {
    const published = ids.get("published")!
    await authorize(page, STAFF.admin)
    await page.goto(`/admin/articles/${published.translationId}`)
    await page.locator('[data-article-open-action="archive"]').click()
    await page.locator("[data-article-action-reason]").fill("T072 staff reason")
    await page.locator("[data-article-submit]").click()
    await expect
      .poll(async () => (await prisma.article.findUniqueOrThrow({ where: { id: published.articleId } })).status)
      .toBe("archived")

    await authorize(page, STAFF.owner)
    await page.reload()
    await expect(page.locator('[data-article-action="restore"]')).toBeVisible()
    await page.locator('[data-article-action="restore"]').click()
    await expect
      .poll(async () => (await prisma.article.findUniqueOrThrow({ where: { id: published.articleId } })).status)
      .toBe("published")
  })
})
