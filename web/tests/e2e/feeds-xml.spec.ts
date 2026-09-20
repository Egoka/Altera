import { expect, test } from "@playwright/test"

// Машиночитаемые маршруты собранного сервера: `docs/spec/20-public/feeds-and-sitemap.md`
// §3, §5, §8, §10. База браузерной проверки поднимается миграциями без seed, поэтому здесь
// проверяется состояние «пусто»: валидный фид без материалов и карта со статическими
// адресами. Состав выдачи с материалами закрыт тестами резолвера и сборки XML.

test("лента локали отдаётся валидным RSS с типом и кешем ответа", async ({ request }) => {
  for (const [path, language] of [
    ["/rss.xml", "ru-RU"],
    ["/en/rss.xml", "en-US"]
  ]) {
    const response = await request.get(path!)

    expect(response.status(), path).toBe(200)
    expect(response.headers()["content-type"]).toContain("application/rss+xml")
    expect(response.headers()["cache-control"]).toContain("max-age=3600")

    const body = await response.text()
    expect(body).toContain('<?xml version="1.0" encoding="utf-8"?>')
    expect(body).toContain('<rss version="2.0"')
    expect(body).toContain(`<language>${language}</language>`)
    // Пустая лента — канал без элементов, а не отказ (§8).
    expect(body).not.toContain("<item>")
    expect(body.trimEnd().endsWith("</rss>")).toBe(true)
  }
})

test("индекс карты сайта перечисляет карты обеих локалей", async ({ request, baseURL }) => {
  const response = await request.get("/sitemap.xml")

  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toContain("application/xml")

  const body = await response.text()
  expect(body).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
  expect(body).toContain(`<loc>${baseURL}/sitemap-ru.xml</loc>`)
  expect(body).toContain(`<loc>${baseURL}/sitemap-en.xml</loc>`)
})

test("карта локали содержит главную и статические страницы, но не личные разделы", async ({ request, baseURL }) => {
  for (const [path, home] of [
    ["/sitemap-ru.xml", `${baseURL}/`],
    ["/sitemap-en.xml", `${baseURL}/en`]
  ]) {
    const response = await request.get(path!)

    expect(response.status(), path).toBe(200)

    const body = await response.text()
    expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
    expect(body).toContain(`<loc>${home}</loc>`)
    expect(body).toContain("<priority>1.0</priority>")
    // Кабинет, админка и вход роботу не отдаются (§4).
    for (const forbidden of ["/me", "/admin", "/auth", "/search"]) {
      expect(body, `${path} без ${forbidden}`).not.toContain(`<loc>${baseURL}${forbidden}`)
    }
  }
})

test("страница объявляет ленту своей локали", async ({ request }) => {
  const russian = await request.get("/")
  const english = await request.get("/en")

  expect(await russian.text()).toContain('type="application/rss+xml"')
  expect(await english.text()).toContain('href="/en/rss.xml"')
})
