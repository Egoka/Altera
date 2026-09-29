import { expect, test, type Page } from "./helpers/test"
import { PrismaClient, type ArticleStatus, type Role } from "../../../server/src/generated/prisma/index.js"
import { createSessionId, signAccessToken } from "./helpers/session-token"

/**
 * T-050: живая очередь проверки. Спек фиксирует три строки состояния, атомарное закрепление
 * между двумя модераторами и немедленную публичную видимость после ручной публикации.
 */

const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const prisma = new PrismaClient({ datasourceUrl: databaseUrl })

const STAFF = {
  first: { id: "t050-moderator-one", handle: "t050-moderator-one", sessionId: "" },
  second: { id: "t050-moderator-two", handle: "t050-moderator-two", sessionId: "" }
}
const AUTHOR_ID = "t050-author"
const AUTHOR_HANDLE = "t050-author"
const SECTION_ID = "t050-section"
const SECTION_SLUG = "t050-review"
const COVER_ID = "t050-cover"

const fixtures = {
  queued: { slug: "t050-queued", title: "T050 материал в очереди", status: "review" as ArticleStatus, reads: 11 },
  claimed: {
    slug: "t050-claimed",
    title: "T050 материал на проверке",
    status: "in_review" as ArticleStatus,
    reads: 22
  },
  rework: { slug: "t050-rework", title: "T050 материал на доработке", status: "rework" as ArticleStatus, reads: 33 },
  conflict: { slug: "t050-conflict", title: "T050 конфликт ревьюеров", status: "review" as ArticleStatus, reads: 44 },
  publish: { slug: "t050-publish", title: "T050 ручная публикация", status: "review" as ArticleStatus, reads: 55 }
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

async function seedArticle(fixture: (typeof fixtures)[keyof typeof fixtures]) {
  await prisma.article.deleteMany({ where: { slug: fixture.slug } })
  const article = await prisma.article.create({
    data: {
      title: fixture.title,
      slug: fixture.slug,
      body: `${fixture.title}. Текст публичной версии.`,
      status: "draft",
      sourceLocale: "ru",
      authorId: AUTHOR_ID,
      sectionId: SECTION_ID,
      coverAssetId: COVER_ID
    }
  })
  const translation = await prisma.articleTranslation.findFirstOrThrow({ where: { articleId: article.id } })
  const reviewer = fixture.status === "in_review" ? STAFF.first : null
  await prisma.articleTranslation.update({
    where: { id: translation.id },
    data: {
      title: fixture.title,
      body: document(fixture.title),
      status: fixture.status,
      readCount: fixture.reads,
      reviewerId: reviewer?.id ?? null,
      reviewerRole: reviewer ? "moderator" : null,
      reviewClaimedAt: reviewer ? new Date("2026-09-29T09:00:00.000Z") : null
    }
  })
  await prisma.articleRevision.updateMany({
    where: { translationId: translation.id },
    data: { title: fixture.title, body: document(fixture.title) }
  })
  return translation.id
}

test.describe("очередь ручной проверки", () => {
  test.describe.configure({ mode: "serial" })
  const translationIds = new Map<keyof typeof fixtures, string>()

  test.beforeAll(async () => {
    await upsertUser({
      id: STAFF.first.id,
      handle: STAFF.first.handle,
      name: "T050 Первый модератор",
      role: "moderator",
      service: true
    })
    await upsertUser({
      id: STAFF.second.id,
      handle: STAFF.second.handle,
      name: "T050 Второй модератор",
      role: "moderator",
      service: true
    })
    await upsertUser({ id: AUTHOR_ID, handle: AUTHOR_HANDLE, name: "Вера Орлова", role: "author", service: false })

    await prisma.sectionSlugHistory.upsert({
      where: { slug: SECTION_SLUG },
      update: {},
      create: { slug: SECTION_SLUG }
    })
    await prisma.section.upsert({
      where: { id: SECTION_ID },
      update: { slug: SECTION_SLUG, name: "T050 Проверка", nameEn: "T050 Review", status: "active" },
      create: {
        id: SECTION_ID,
        slug: SECTION_SLUG,
        name: "T050 Проверка",
        nameEn: "T050 Review",
        status: "active",
        order: 5050
      }
    })
    await prisma.sectionSlugHistory.update({ where: { slug: SECTION_SLUG }, data: { ownerSectionId: SECTION_ID } })
    await prisma.mediaAsset.upsert({
      where: { id: COVER_ID },
      update: { processingStatus: "ready", deletedAt: null },
      create: {
        id: COVER_ID,
        ownerId: AUTHOR_ID,
        storageKey: "2026/09/t050-cover.webp",
        mimeType: "image/webp",
        byteSize: 512,
        width: 960,
        height: 640,
        sha256: "t050-cover-sha256",
        variants: [],
        processingStatus: "ready",
        attribution: "Вера Орлова",
        license: "own"
      }
    })

    for (const [key, fixture] of Object.entries(fixtures) as Array<
      [keyof typeof fixtures, (typeof fixtures)[keyof typeof fixtures]]
    >) {
      translationIds.set(key, await seedArticle(fixture))
    }

    await prisma.session.deleteMany({ where: { userId: { in: [STAFF.first.id, STAFF.second.id] } } })
    STAFF.first.sessionId = await createSessionId(prisma, STAFF.first.id)
    STAFF.second.sessionId = await createSessionId(prisma, STAFF.second.id)
  })

  test.afterAll(async () => {
    await prisma.article.deleteMany({ where: { slug: { in: Object.values(fixtures).map(({ slug }) => slug) } } })
    await prisma.$disconnect()
  })

  for (const [state, key] of [
    ["queued", "queued"],
    ["in_review", "claimed"],
    ["rework", "rework"]
  ] as const) {
    test(`показывает строку состояния ${state} с точным числом прочтений`, async ({ page }) => {
      await authorize(page, STAFF.first)
      await page.goto(`/admin/review?state=${state}`)

      const row = page.locator(`a[href="/admin/review/${translationIds.get(key)}"]`).locator("xpath=ancestor::tr")
      await expect(row).toContainText(fixtures[key].title)
      await expect(row.locator("[data-review-reads]")).toHaveText(String(fixtures[key].reads))
      await expect(row.locator("[data-review-author]")).toContainText("Вера Орлова · @t050-author")
    })
  }

  test("второй модератор получает CONFLICT и не перезаписывает закрепление", async ({ page }) => {
    const id = translationIds.get("conflict")!
    const mutation = `mutation Claim($id: ID!) { claimReview(id: $id) { id reviewer { role mine } } }`
    const first = await page.request.post("/api/graphql", {
      headers: { authorization: `Bearer ${signAccessToken(STAFF.first.id, STAFF.first.sessionId)}` },
      data: { query: mutation, variables: { id } }
    })
    expect((await first.json()) as { data?: unknown }).toHaveProperty("data.claimReview.id", id)

    const second = await page.request.post("/api/graphql", {
      headers: { authorization: `Bearer ${signAccessToken(STAFF.second.id, STAFF.second.sessionId)}` },
      data: { query: mutation, variables: { id } }
    })
    const body = (await second.json()) as { errors?: Array<{ extensions?: { code?: string } }> }
    expect(body.errors?.[0]?.extensions?.code).toBe("CONFLICT")

    const saved = await prisma.articleTranslation.findUniqueOrThrow({ where: { id } })
    expect(saved.reviewerId).toBe(STAFF.first.id)
  })

  test("ручная публикация сразу видна гостю", async ({ page, browser }) => {
    const id = translationIds.get("publish")!
    await authorize(page, STAFF.first)
    await page.goto(`/admin/review/${id}`)
    await page.getByRole("button", { name: /взять на проверку|claim review/i }).click()
    await expect(page.locator('[data-review-open-action="publish"]')).toBeVisible()
    await page.locator('[data-review-open-action="publish"]').click()
    await page.locator("[data-review-action-text]").fill("Проверено вручную")
    await page.locator("[data-review-submit]").click()

    await expect
      .poll(async () => (await prisma.articleTranslation.findUniqueOrThrow({ where: { id } })).status)
      .toBe("published")

    const guest = await browser.newContext()
    const guestPage = await guest.newPage()
    const goneResponse = await guestPage.request.post("http://127.0.0.1:4173/api/graphql", {
      data: {
        query: `query Gone($locale: Locale!, $sectionSlug: String!, $slug: String!) {
          gone(locale: $locale, sectionSlug: $sectionSlug, slug: $slug) { title firstPublishedAt }
        }`,
        variables: { locale: "ru", sectionSlug: SECTION_SLUG, slug: fixtures.publish.slug }
      }
    })
    expect(await goneResponse.json()).toMatchObject({ errors: [{ extensions: { code: "NOT_FOUND" } }] })
    const publicResponse = await guestPage.request.post("http://127.0.0.1:4173/api/graphql", {
      data: {
        query: `query PublicArticle($slug: String!) {
          article(slug: $slug) {
            id title slug dek body excerpt featuredImage status publishedAt createdAt updatedAt
            author { id name handle bio photoUrl socialLinks }
            section { name slug }
            tags { name slug }
          }
        }`,
        variables: { slug: fixtures.publish.slug }
      }
    })
    expect(await publicResponse.json()).toMatchObject({
      data: { article: { title: fixtures.publish.title, status: "published" } }
    })
    await guestPage.goto(`/${SECTION_SLUG}`)
    await expect(guestPage.getByRole("link", { name: fixtures.publish.title }).first()).toBeVisible()
    await guest.close()
  })
})
