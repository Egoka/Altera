import { describe, expect, it } from "vitest"
import { isCacheablePath, readCachedPages } from "../app/composables/useOfflinePage"
import { reportablePath } from "../app/composables/useBrokenLinkReport"

// Чтение Cache Storage и отбор адресов (`docs/spec/20-public/offline.md` §4): личное и
// административное офлайн не кешируется вовсе, поэтому в список оно попасть не должно.

const response = (body: string, headers: Record<string, string>) => ({
  headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  text: async () => body
})

const storage = (entries: { url: string; method?: string; body: string; headers: Record<string, string> }[]) => ({
  keys: async () => ["pages"],
  open: async () => ({
    keys: async () => entries.map((entry) => ({ url: entry.url, method: entry.method ?? "GET" })),
    match: async (request: { url: string }) => {
      const found = entries.find((entry) => entry.url === request.url)
      return found ? response(found.body, found.headers) : undefined
    }
  })
})

const html = (title: string) => `<html><head><title>${title}</title></head><body></body></html>`
const htmlHeaders = { "content-type": "text/html; charset=utf-8", date: "Sat, 19 Sep 2026 08:00:00 GMT" }

describe("адреса, пригодные для офлайн-списка", () => {
  it("принимает публичные материалы обеих локалей", () => {
    expect(isCacheablePath("/culture/essay")).toBe(true)
    expect(isCacheablePath("/en/culture/essay")).toBe(true)
  })

  it("отбрасывает личное, административное и служебное", () => {
    for (const path of ["/me", "/me/bookmarks", "/admin/articles", "/auth/verify", "/api/graphql", "/offline", "/"]) {
      expect(isCacheablePath(path)).toBe(false)
    }
  })
})

describe("чтение сохранённых страниц", () => {
  it("собирает заголовок, рубрику и дату посещения", async () => {
    const pages = await readCachedPages(
      storage([
        { url: "https://altera.test/culture/essay", body: html("Эссе о городе"), headers: htmlHeaders }
      ]) as never,
      "https://altera.test"
    )

    expect(pages).toEqual([
      {
        path: "/culture/essay",
        title: "Эссе о городе",
        section: "culture",
        visitedAt: "Sat, 19 Sep 2026 08:00:00 GMT"
      }
    ])
  })

  it("пропускает чужой домен, не-HTML и закрытые разделы", async () => {
    const pages = await readCachedPages(
      storage([
        { url: "https://other.test/culture/essay", body: html("Чужое"), headers: htmlHeaders },
        {
          url: "https://altera.test/_nuxt/app.js",
          body: "console.log(1)",
          headers: { "content-type": "text/javascript" }
        },
        { url: "https://altera.test/me/bookmarks", body: html("Закладки"), headers: htmlHeaders }
      ]) as never,
      "https://altera.test"
    )

    expect(pages).toEqual([])
  })
})

describe("путь обращения о битой ссылке", () => {
  it("отбрасывает query: чужая ссылка может нести персональные данные", () => {
    expect(reportablePath("/culture/essay?utm_source=letter&email=a@b.c")).toBe("/culture/essay")
    expect(reportablePath("/culture/essay")).toBe("/culture/essay")
  })
})
