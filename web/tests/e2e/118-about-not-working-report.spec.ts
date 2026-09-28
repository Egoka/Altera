import { expect, test, type Page, type Route } from "./helpers/test"
import { navigateOnClient } from "./helpers/hydration"

/**
 * T-118: зона «что ещё не работает» на «О проекте» и кнопка «Пожаловаться» у материала
 * (`docs/spec/20-public/about.md` §5 зона 6, `contact.md` §3; журнал §37 п. 1, 9).
 *
 * Критерий 1 — список выводится из опубликованного текста владельца; критерий 2 — кнопка ведёт на
 * `/contact` со ссылкой на материал. Текст вида `about` параллельно публикует `admin-legal.spec.ts`,
 * поэтому база здесь не меняется: обе страницы открываются клиентским переходом с подстановкой
 * ответа `/api/graphql`, как в `59-about-contact.spec.ts`.
 */

// `fallback`, а не `continue`: чужой запрос уходит к ранее зарегистрированной подстановке.
const fulfillOperation = (page: Page, operation: string, body: unknown) =>
  page.route("**/api/graphql", async (route: Route) => {
    const payload = JSON.parse(route.request().postData() ?? "{}")
    if (!String(payload.query ?? "").includes(operation)) return route.fallback()
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
  })

const aboutText = (html: string) => ({
  data: {
    staticText: {
      kind: "about",
      locale: "ru",
      requestedLocale: "ru",
      isFallbackLocale: false,
      version: 4,
      publishedAt: "2026-09-26T00:00:00.000Z",
      html,
      availableLocales: ["ru"]
    },
    sectionCatalog: []
  }
})

const NOT_WORKING_HTML = [
  '<h2 id="status">Статус проекта</h2><p>Журнал открыт, часть работы ещё впереди.</p>',
  '<h2 id="not-working">Что ещё не работает</h2>',
  "<ul><li>Редактор статьи: страница правки — заглушка</li>",
  '<li>Письма уходят только в вывод, <a href="/legal/terms">почтового провайдера нет</a></li></ul>',
  '<h2 id="rights">Права и честность</h2><p>Права на материалы у авторов.</p>'
].join("")

const ARTICLE_PATH = "/culture/t118-gorod-slushaet-more"

const stubArticle = async (page: Page) => {
  await fulfillOperation(page, "GetGoneArticle", {
    errors: [{ message: "not found", extensions: { code: "NOT_FOUND" } }]
  })
  await fulfillOperation(page, "GetArticle", {
    data: {
      article: {
        id: "t118-article",
        title: "Город, который слушает море",
        slug: "t118-gorod-slushaet-more",
        dek: null,
        body: null,
        excerpt: null,
        featuredImage: null,
        status: "published",
        publishedAt: "2026-09-20T12:00:00.000Z",
        createdAt: "2026-09-19T12:00:00.000Z",
        updatedAt: "2026-09-20T12:00:00.000Z",
        author: {
          id: "t118-author",
          name: "Анна Волкова",
          slug: "anna-volkova",
          bio: null,
          photoUrl: null,
          socialLinks: null
        },
        section: { name: "Культура", slug: "culture" },
        tags: []
      }
    }
  })
}

test.describe("«Что ещё не работает» на «О проекте»", () => {
  test("список выводится из опубликованного текста владельца отдельной зоной", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await fulfillOperation(page, "GetAboutPage", aboutText(NOT_WORKING_HTML))

    await navigateOnClient(page, "/about")

    const zone = page.getByTestId("about-not-working")
    await expect(zone).toContainText("Что ещё не работает")
    await expect(zone.getByTestId("about-not-working-item")).toHaveCount(2)
    await expect(zone.getByTestId("about-not-working-item").first()).toContainText("Редактор статьи")
    // Ссылки владельца остаются: пункты приходят из той же проверенной разметки.
    await expect(zone.getByRole("link", { name: "почтового провайдера нет" })).toHaveAttribute("href", "/legal/terms")
    // Вынесенный раздел не дублируется в общем тексте, остальные разделы на месте.
    await expect(page.getByTestId("about-body")).toContainText("Права на материалы у авторов.")
    await expect(page.getByTestId("about-body")).not.toContainText("Редактор статьи")
  })

  test("без раздела «что ещё не работает» зоны нет, текст показан целиком", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await fulfillOperation(page, "GetAboutPage", aboutText('<h2 id="status">Статус проекта</h2><p>Журнал открыт.</p>'))

    await navigateOnClient(page, "/about")

    await expect(page.getByTestId("about-not-working")).toHaveCount(0)
    await expect(page.getByTestId("about-body")).toContainText("Журнал открыт.")
  })
})

test.describe("кнопка «Пожаловаться» у материала", () => {
  test("ведёт на «Письмо в редакцию» со ссылкой на материал", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await stubArticle(page)

    await navigateOnClient(page, ARTICLE_PATH)

    const report = page.getByTestId("article-report")
    await expect(report).toHaveAttribute("href", `/contact?topic=other&path=${encodeURIComponent(ARTICLE_PATH)}`)

    await report.click()

    // Форма обращения открылась с адресом материала: он уходит в обращение (§3, §5 зона 3).
    await expect(page.getByTestId("contact-path-line")).toContainText(ARTICLE_PATH)
    await page.getByTestId("contact-path-edit").click()
    await expect(page.getByTestId("contact-path")).toHaveValue(ARTICLE_PATH)
    await expect(page.getByTestId("contact-topic")).toHaveValue("other")
  })
})
