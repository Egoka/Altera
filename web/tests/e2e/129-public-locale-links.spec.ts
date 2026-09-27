import { expect, test, type Page } from "./helpers/test"
import { withPrisma } from "./helpers/auth-fixtures"

/**
 * T-129: публичные страницы на `/en` остаются в своей локали.
 *
 * Данные здесь настоящие, а не подставленные: AC-3 требует меню шапки в ответе SSR, а его
 * даёт только живой API. Поэтому сценарий заводит свою рубрику с материалами обоих языков,
 * рубрику без английских материалов, архивированную рубрику с преемником и слитый тег.
 *
 * Все фикстуры названы с префиксом `t129-`: прогон идёт по общей базе, и чужие рубрики в
 * меню не мешают — проверяется присутствие своих и отсутствие своей же «только русской».
 */
const AUTHOR_ID = "t129-author"
const AUTHOR_HANDLE = "t129-vera"
const SECTION = "t129-culture"
const RUSSIAN_ONLY_SECTION = "t129-ru-only"
const ARCHIVED_SECTION = "t129-gone"
const TAG = "t129-ai"
const MERGED_TAG = "t129-merged"

const seedSection = async (
  prisma: Awaited<Parameters<Parameters<typeof withPrisma>[0]>[0]>,
  input: { slug: string; name: string; nameEn: string; order: number }
) => {
  await prisma.sectionSlugHistory.upsert({ where: { slug: input.slug }, create: { slug: input.slug }, update: {} })
  await prisma.section.upsert({
    where: { slug: input.slug },
    update: { name: input.name, nameEn: input.nameEn, status: "active", successorId: null },
    create: { id: input.slug, slug: input.slug, name: input.name, nameEn: input.nameEn, order: input.order }
  })
  await prisma.sectionSlugHistory.update({
    where: { slug: input.slug },
    data: { ownerSectionId: input.slug, redirectToSectionId: null }
  })
}

test.beforeAll(async () => {
  await withPrisma(async (prisma) => {
    await prisma.handleHistory.upsert({
      where: { handle: AUTHOR_HANDLE },
      update: {},
      create: { handle: AUTHOR_HANDLE }
    })
    await prisma.user.upsert({
      where: { id: AUTHOR_ID },
      update: { archivedAt: null },
      create: {
        id: AUTHOR_ID,
        email: "t129-author@example.test",
        handle: AUTHOR_HANDLE,
        name: "T129 Vera Orlova",
        bio: "T129 author bio."
      }
    })
    await prisma.handleHistory.update({ where: { handle: AUTHOR_HANDLE }, data: { userId: AUTHOR_ID } })

    await seedSection(prisma, { slug: SECTION, name: "T129 Культура", nameEn: "T129 Culture", order: 1290 })
    await seedSection(prisma, {
      slug: RUSSIAN_ONLY_SECTION,
      name: "T129 Только по-русски",
      nameEn: "T129 Russian only",
      order: 1291
    })
    await seedSection(prisma, { slug: ARCHIVED_SECTION, name: "T129 Ушедшая", nameEn: "T129 Gone", order: 1292 })
    // Архивированная рубрика остаётся адресом и ведёт на преемника (`admin-sections.md` #2).
    await prisma.section.update({
      where: { slug: ARCHIVED_SECTION },
      data: { status: "archived", archivedAt: new Date(), successorId: SECTION }
    })

    for (const slug of [TAG, MERGED_TAG]) {
      await prisma.tagSlugHistory.upsert({ where: { slug }, create: { slug }, update: {} })
      await prisma.tag.upsert({
        where: { slug },
        update: { status: "active", mergedIntoId: null },
        create: { id: slug, slug, name: `${slug} ру`, nameEn: `${slug} en` }
      })
      await prisma.tagSlugHistory.update({ where: { slug }, data: { ownerTagId: slug, redirectToTagId: null } })
    }
    // Слитый тег переехал в целевой и отвечает 301 (`tag-feed.md` §2).
    await prisma.tag.update({ where: { slug: MERGED_TAG }, data: { mergedIntoId: TAG } })

    const publishedAt = new Date("2026-09-18T10:00:00.000Z")
    const articles = [
      { slug: "t129-ru-article", title: "T129 материал", locale: "ru" as const, section: SECTION },
      { slug: "t129-en-article", title: "T129 article", locale: "en" as const, section: SECTION },
      { slug: "t129-ru-only-article", title: "T129 только ру", locale: "ru" as const, section: RUSSIAN_ONLY_SECTION }
    ]
    for (const article of articles) {
      await prisma.article.upsert({
        where: { slug: article.slug },
        update: { status: "published", publishedAt, firstPublishedAt: publishedAt },
        create: {
          slug: article.slug,
          title: article.title,
          body: "T129 body",
          status: "published",
          publishedAt,
          firstPublishedAt: publishedAt,
          sourceLocale: article.locale,
          authorId: AUTHOR_ID,
          sectionId: article.section,
          tags: { connect: [{ slug: TAG }] }
        }
      })
    }
  })
})

/**
 * Внутренние ссылки страницы. Переключатель языка исключён намеренно: он и обязан вести в
 * другую локаль — это его работа.
 */
const internalLinks = (page: Page) =>
  page.$$eval("a[href]", (anchors) =>
    anchors
      .filter((anchor) => (anchor.getAttribute("aria-label") ?? "").startsWith("Switch language") === false)
      .map((anchor) => anchor.getAttribute("href") ?? "")
      .filter((href) => href.startsWith("/") && !href.startsWith("//"))
  )

const ENGLISH_PAGES = [
  "/en",
  `/en/${SECTION}`,
  `/en/tags/${TAG}`,
  "/en/authors",
  `/en/authors/${AUTHOR_HANDLE}`,
  `/en/${SECTION}?page=1`
]

// AC-1: все внутренние ссылки английских страниц начинаются с `/en`.
for (const path of ENGLISH_PAGES) {
  test(`AC-1: внутренние ссылки ${path} остаются в английской локали`, async ({ page }) => {
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)

    const links = await internalLinks(page)

    expect(links.length).toBeGreaterThan(0)
    expect(links.filter((href) => href !== "/en" && !href.startsWith("/en/"))).toEqual([])
  })
}

// AC-2: переезд адреса на `/en` ведёт на английский адрес цели.
test("AC-2: 301 архивированной рубрики и слитого тега остаётся в /en", async ({ request }) => {
  const section = await request.get(`/en/${ARCHIVED_SECTION}`, { maxRedirects: 0 })
  expect(section.status()).toBe(301)
  expect(section.headers().location).toBe(`/en/${SECTION}`)

  const tag = await request.get(`/en/tags/${MERGED_TAG}`, { maxRedirects: 0 })
  expect(tag.status()).toBe(301)
  expect(tag.headers().location).toBe(`/en/tags/${TAG}`)

  // Русские адреса тех же переездов остаются русскими.
  const russianSection = await request.get(`/${ARCHIVED_SECTION}`, { maxRedirects: 0 })
  expect(russianSection.headers().location).toBe(`/${SECTION}`)
})

/**
 * Разметка страницы без полезной нагрузки гидратации: в `__NUXT_DATA__` лежит весь ответ
 * API, включая `nameEn`, и по нему нельзя судить о том, что читатель видит на странице.
 */
const renderedMarkup = (html: string) => html.slice(0, html.indexOf('<script type="application/json"'))

// AC-3: меню шапки на `/en` — только рубрики с английскими материалами, с их `nameEn`.
test("AC-3: меню шапки /en приходит в ответе SSR с английскими названиями", async ({ request }) => {
  const english = await request.get("/en")
  expect(english.status()).toBe(200)
  const englishHtml = renderedMarkup(await english.text())

  expect(englishHtml).toContain(`href="/en/${SECTION}"`)
  expect(englishHtml).toContain(">T129 Culture<")
  // Рубрика без английских материалов в английское меню не попадает (журнал §20.9).
  expect(englishHtml).not.toContain(`href="/en/${RUSSIAN_ONLY_SECTION}"`)
  expect(englishHtml).not.toContain(">T129 Только по-русски<")
  // Архивированная рубрика публичной не остаётся, только её адрес отвечает 301.
  expect(englishHtml).not.toContain(`href="/en/${ARCHIVED_SECTION}"`)

  const russianHtml = renderedMarkup(await (await request.get("/")).text())

  expect(russianHtml).toContain(`href="/${SECTION}"`)
  expect(russianHtml).toContain(">T129 Только по-русски<")
  expect(russianHtml).not.toContain(">T129 Culture<")
})
