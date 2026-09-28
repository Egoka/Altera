// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { computed, ref, watch } from "vue"
import { beforeEach, describe, expect, it, vi } from "vitest"
import EditorBlockCanvas from "../app/components/editor/BlockCanvas.vue"
import EditorConflictDialog from "../app/components/editor/ConflictDialog.vue"
import EditorCoverUploader from "../app/components/editor/CoverUploader.vue"
import EditorSidePanel from "../app/components/editor/SidePanel.vue"

/**
 * T-040: зоны редактора (`docs/spec/30-account/author/article-edit.md` §5).
 *
 * Критерий 1 — при конфликте автор видит баннер с двумя выходами, а не потерянный текст.
 * Критерий 2 — обложки нет, и её место занято заполнителем с прямым указанием, что без неё
 * материал не отправляется (журнал §29.1).
 */

const messages: Record<string, string> = {
  "myArticles.editor.conflict.title": "Версия изменилась в другой вкладке",
  "myArticles.editor.conflict.fresh": "Открыть свежую",
  "myArticles.editor.conflict.copy": "Сохранить копию как ревизию",
  "myArticles.editor.cover.title": "Обложка",
  "myArticles.editor.cover.empty": "Обложки нет. Она обязательна перед отправкой к публикации.",
  "myArticles.editor.blocks.add": "Добавить абзац",
  "myArticles.editor.blocks.kind.paragraph": "Абзац",
  "myArticles.editor.blocks.kind.figure": "Изображение",
  "myArticles.editor.blocks.figure": "Изображение {id}: подпись из медиафайла.",
  "myArticles.editor.panel.tabs.revisions": "Ревизии",
  "myArticles.editor.panel.seo.slugLocked": "Адрес закреплён после первой публикации."
}

const global = {
  stubs: { NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' } }
}

beforeEach(() => {
  // В Nuxt `computed`, `ref`, `watch` и `useI18n` приходят автоимпортом.
  vi.stubGlobal("computed", computed)
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("watch", watch)
  vi.stubGlobal("useI18n", () => ({
    t: (key: string, params: Record<string, string> = {}) =>
      Object.entries(params).reduce(
        (message, [name, value]) => message.replace(`{${name}}`, value),
        messages[key] ?? key
      )
  }))
})

describe("T-040 диалог конфликта", () => {
  it("критерий 1: баннер предлагает открыть свежую версию или сохранить копию", async () => {
    const wrapper = mount(EditorConflictDialog, { props: { open: true }, global })

    expect(wrapper.find('[data-testid="editor-conflict"]').exists()).toBe(true)
    expect(wrapper.text()).toContain("Версия изменилась в другой вкладке")

    await wrapper.get('[data-testid="editor-conflict-fresh"]').trigger("click")
    await wrapper.get('[data-testid="editor-conflict-copy"]').trigger("click")

    expect(wrapper.emitted("fresh")).toHaveLength(1)
    expect(wrapper.emitted("copy")).toHaveLength(1)
  })

  it("без конфликта баннера нет", () => {
    const wrapper = mount(EditorConflictDialog, { props: { open: false }, global })

    expect(wrapper.find('[data-testid="editor-conflict"]').exists()).toBe(false)
  })
})

describe("T-040 обложка в редакторе", () => {
  const coverProps = { cover: null, busy: false, readOnly: false, errorKey: null }

  it("критерий 2: без обложки показан заполнитель и сказано, что она обязательна", () => {
    const wrapper = mount(EditorCoverUploader, { props: coverProps, global })

    expect(wrapper.find('[data-testid="editor-cover-placeholder"]').exists()).toBe(true)
    expect(wrapper.text()).toContain("обязательна перед отправкой")
  })

  it("загрузка недоступна без указания авторства: лицензия и атрибуция обязательны", async () => {
    const wrapper = mount(EditorCoverUploader, { props: coverProps, global })

    expect(wrapper.get('[data-testid="editor-cover-upload"]').attributes("disabled")).toBeDefined()
  })

  it("в режиме чтения загрузчика нет", () => {
    const wrapper = mount(EditorCoverUploader, { props: { ...coverProps, readOnly: true }, global })

    expect(wrapper.find('[data-testid="editor-cover-upload"]').exists()).toBe(false)
  })

  it("предпросмотр кадра повторяет фокусную точку через object-position", () => {
    const cover = { assetId: "cover-1", url: "/media/cover-w960.webp", alt: "Залив", focal: { x: 0.25, y: 0 } }
    const wrapper = mount(EditorCoverUploader, { props: { ...coverProps, cover }, global })

    expect(wrapper.get('[data-testid="editor-cover-preview"]').attributes("style")).toContain("object-position: 25% 0%")
  })
})

describe("T-040 область блоков", () => {
  const blocks = [
    { id: "block-1", type: "paragraph" as const, text: "Первый абзац" },
    { id: "block-2", type: "figure" as const, text: "", assetId: "asset-1" }
  ]

  it("правка блока сообщает его идентификатор и новый текст", async () => {
    const wrapper = mount(EditorBlockCanvas, { props: { blocks, readOnly: false }, global })

    const field = wrapper.get("textarea")
    await field.setValue("Другой текст")

    expect(wrapper.emitted("update")?.[0]).toEqual(["block-1", "Другой текст"])
  })

  it("изображение правится не текстом: у него нет поля ввода", () => {
    const wrapper = mount(EditorBlockCanvas, { props: { blocks, readOnly: false }, global })

    expect(wrapper.findAll("textarea")).toHaveLength(1)
    expect(wrapper.text()).toContain("Изображение asset-1")
  })

  it("режим чтения не даёт ни добавить блок, ни удалить", () => {
    const wrapper = mount(EditorBlockCanvas, { props: { blocks, readOnly: true }, global })

    expect(wrapper.find('[data-testid="editor-add-block"]').exists()).toBe(false)
    expect(wrapper.get("textarea").attributes("readonly")).toBeDefined()
  })
})

describe("T-040 боковая панель", () => {
  const panelProps = {
    tab: "seo" as const,
    translationId: "translation-1",
    status: "published",
    rejected: false,
    readOnly: false,
    currentRevisionId: "revision-9",
    revisions: [],
    siblings: [],
    seoDescription: "Описание",
    slug: "moj-material",
    slugLocked: true
  }

  it("после первой публикации адрес закреплён и кнопки сохранения нет", () => {
    const wrapper = mount(EditorSidePanel, { props: panelProps, global })

    expect(wrapper.get('[data-testid="editor-seo-slug"]').attributes("readonly")).toBeDefined()
    expect(wrapper.find('[data-testid="editor-seo-slug-save"]').exists()).toBe(false)
    expect(wrapper.text()).toContain("Адрес закреплён")
  })

  it("до публикации адрес сохраняется кнопкой", async () => {
    const wrapper = mount(EditorSidePanel, { props: { ...panelProps, slugLocked: false }, global })

    await wrapper.get('[data-testid="editor-seo-slug-save"]').trigger("click")

    expect(wrapper.emitted("slug")?.[0]).toEqual(["moj-material"])
  })

  it("выбор вкладки сообщается наружу: она живёт в адресе страницы", async () => {
    const wrapper = mount(EditorSidePanel, { props: panelProps, global })

    await wrapper.get('[data-testid="editor-tab-revisions"]').trigger("click")

    expect(wrapper.emitted("tab")?.[0]).toEqual(["revisions"])
  })
})
