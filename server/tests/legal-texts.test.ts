import { describe, expect, it, vi } from "vitest"
import {
  assertSafeLegalHtml,
  extractLegalAnchors,
  legalPath,
  publishLegalVersion,
  readPublicLegalText
} from "../src/legal/texts"

// Механизм версий юридических текстов (T-101, `docs/spec/20-public/legal-*.md` §4, §8).

interface FakeText {
  id: string
  kind: string
  locale: "ru" | "en"
  version: number
  status: "draft" | "published" | "previous"
  publishedAt: Date | null
  isMaterial: boolean
  summaryOfChanges: string
  body: string
}

const text = (overrides: Partial<FakeText> & Pick<FakeText, "id" | "version" | "status">): FakeText => ({
  kind: "terms",
  locale: "ru",
  publishedAt: new Date("2026-09-01T00:00:00.000Z"),
  isMaterial: false,
  summaryOfChanges: "Редакция",
  body: `<h2 id="subject">Предмет</h2><p>${overrides.id}</p>`,
  ...overrides
})

const readerOf = (texts: FakeText[]) => ({
  legalText: {
    findMany: vi.fn(async ({ where }: { where: { kind: string; status: { in: string[] } } }) =>
      texts
        .filter((item) => item.kind === where.kind && where.status.in.includes(item.status))
        .sort((left, right) => right.version - left.version)
    ),
    findUnique: vi.fn(
      async ({ where }: { where: { id: string } }) => texts.find((item) => item.id === where.id) ?? null
    )
  }
})

describe("оглавление юридического текста", () => {
  it("собирает разделы второго уровня с якорями и очищает заголовок от разметки", () => {
    const html = [
      '<h2 id="rights">Права <em>автора</em></h2><p>…</p>',
      "<h2>Без якоря</h2>",
      '<h3 id="nested">Подраздел</h3>',
      "<h2 class=\"x\" id='ai-training'>Обучение &amp; ИИ</h2>"
    ].join("")

    expect(extractLegalAnchors(html)).toEqual([
      { id: "rights", title: "Права автора" },
      { id: "ai-training", title: "Обучение & ИИ" }
    ])
  })

  it("строит адрес страницы вида с дефисом", () => {
    expect(legalPath("content_rules")).toBe("/legal/content-rules")
    expect(legalPath("terms")).toBe("/legal/terms")
  })
})

describe("проверка разметки перед публикацией", () => {
  it.each([
    ["<p>ok</p><script>alert(1)</script>"],
    ['<p onclick="x()">ok</p>'],
    ['<a href="javascript:alert(1)">x</a>'],
    ['<iframe src="https://example.test"></iframe>'],
    ["   "]
  ])("отклоняет %s", (html) => {
    expect(() => assertSafeLegalHtml(html)).toThrow()
  })

  it("пропускает статический текст со ссылками и якорями", () => {
    expect(() =>
      assertSafeLegalHtml('<h2 id="images">Изображения</h2><p><a href="/legal/license#export">экспорт</a></p>')
    ).not.toThrow()
  })
})

describe("чтение публичного текста", () => {
  const texts = [
    text({ id: "terms-ru-1", version: 1, status: "previous" }),
    text({ id: "terms-ru-2", version: 2, status: "published", isMaterial: true }),
    text({ id: "terms-ru-3", version: 3, status: "draft" })
  ]

  it("отдаёт действующую редакцию с архивом, без черновиков", async () => {
    const view = await readPublicLegalText(readerOf(texts) as never, { kind: "terms", locale: "ru" })

    expect(view).toMatchObject({
      version: 2,
      isCurrent: true,
      currentVersion: 2,
      isMaterial: true,
      locale: "ru",
      isFallbackLocale: false,
      anchors: [{ id: "subject", title: "Предмет" }],
      availableLocales: ["ru"]
    })
    expect(view!.previousVersions.map((item) => item.version)).toEqual([1])
    expect(view!.html).toContain("terms-ru-2")
  })

  it("открывает прежнюю редакцию по номеру", async () => {
    const view = await readPublicLegalText(readerOf(texts) as never, { kind: "terms", locale: "ru", version: 1 })
    expect(view).toMatchObject({ version: 1, isCurrent: false, currentVersion: 2 })
  })

  it.each([3, 9])("не показывает черновик и неизвестную редакцию %s", async (version) => {
    await expect(
      readPublicLegalText(readerOf(texts) as never, { kind: "terms", locale: "ru", version })
    ).rejects.toThrow("not found")
  })

  it("показывает другую локаль, если в запрошенной текст не опубликован", async () => {
    const view = await readPublicLegalText(readerOf(texts) as never, { kind: "terms", locale: "en" })
    expect(view).toMatchObject({ locale: "ru", requestedLocale: "en", isFallbackLocale: true })
  })

  it("возвращает null, пока текст вида не опубликован ни в одной локали", async () => {
    await expect(readPublicLegalText(readerOf(texts) as never, { kind: "license", locale: "ru" })).resolves.toBeNull()
    await expect(
      readPublicLegalText(readerOf(texts) as never, { kind: "license", locale: "ru", version: 1 })
    ).rejects.toThrow("not found")
  })
})

describe("публикация редакции", () => {
  it("присваивает следующий номер и переводит действующую редакцию в прежние", async () => {
    const calls: string[] = []
    const tx = {
      legalText: {
        findFirst: vi.fn(async () => ({ version: 2 })),
        updateMany: vi.fn(async (args: unknown) => {
          calls.push(`updateMany ${JSON.stringify(args)}`)
          return { count: 1 }
        }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          calls.push("create")
          return data
        })
      }
    }
    const prisma = { $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)) }

    const created = await publishLegalVersion(prisma as never, {
      kind: "privacy",
      locale: "ru",
      body: '<h2 id="cookies">Cookie</h2>',
      summaryOfChanges: "  Раздел о cookie  ",
      isMaterial: true,
      publishedAt: new Date("2026-09-21T00:00:00.000Z")
    })

    expect(created).toMatchObject({
      kind: "privacy",
      version: 3,
      status: "published",
      isMaterial: true,
      summaryOfChanges: "Раздел о cookie"
    })
    expect(tx.legalText.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: "privacy", locale: "ru", status: { not: "draft" } } })
    )
    expect(calls[0]).toContain('"status":"published"')
    expect(calls[0]).toContain('"data":{"status":"previous"}')
    // Черновик раздела `/admin/legal` уступает номер 3 и становится четвёртым.
    expect(calls[1]).toContain('"status":"draft"')
    expect(calls[1]).toContain('"data":{"version":4}')
    expect(calls[2]).toBe("create")
  })

  it("не публикует небезопасную разметку и редакцию без описания изменений", async () => {
    const prisma = { $transaction: vi.fn() }
    await expect(
      publishLegalVersion(prisma as never, {
        kind: "terms",
        locale: "ru",
        body: "<script></script>",
        summaryOfChanges: "x",
        isMaterial: false
      })
    ).rejects.toThrow()
    await expect(
      publishLegalVersion(prisma as never, {
        kind: "terms",
        locale: "ru",
        body: "<p>ok</p>",
        summaryOfChanges: " ",
        isMaterial: false
      })
    ).rejects.toThrow()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
