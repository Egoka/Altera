// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { computed, defineComponent, h, ref, watch } from "vue"
import { Kind, type DocumentNode } from "graphql"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import LegalPage from "../app/components/legal/Page.vue"
import LicensePage from "../app/pages/legal/license.vue"
import PrivacyPage from "../app/pages/legal/privacy.vue"
import {
  consentFor,
  formatLegalDate,
  LEGAL_PATHS,
  legalVersionParam,
  legalViewerFromCode
} from "../app/utils/legalDocument"

// Строки состояний `docs/spec/20-public/legal-{terms,privacy,content-rules,license}.md` §8 (T-101).

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${Object.values(params).join(",")}` : key

const operationName = (document: DocumentNode): string => {
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) return definition.name?.value ?? ""
  }
  return ""
}

const legalDocument = (overrides: Record<string, unknown> = {}) => ({
  kind: "terms",
  locale: "ru",
  requestedLocale: "ru",
  isFallbackLocale: false,
  version: 2,
  publishedAt: "2026-09-10T00:00:00.000Z",
  isMaterial: true,
  summaryOfChanges: "Уточнён раздел об аккаунте",
  isCurrent: true,
  currentVersion: 2,
  html: '<h2 id="subject">Предмет</h2><p>Текст</p>',
  anchors: [{ id: "subject", title: "Предмет" }],
  previousVersions: [
    { version: 1, publishedAt: "2026-09-01T00:00:00.000Z", isMaterial: false, summaryOfChanges: "Первая" }
  ],
  availableLocales: ["ru"],
  ...overrides
})

const failure = (code: string, requestId = "req-legal") => ({
  data: null,
  errors: [{ extensions: { code, requestId } }]
})

const responses = new Map<string, unknown>()
const graphQLRequest = vi.fn(async (document: DocumentNode) => responses.get(operationName(document)))
const shownErrors: unknown[] = []
const thrown: unknown[] = []
const seo: Record<string, unknown>[] = []
const query = ref<Record<string, unknown>>({})
let pending = false

const stubs = {
  NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
  ReadingErrorState: { props: ["requestId"], template: "<div>{{ requestId }}</div>" },
  ReadingEmptyState: { props: ["title"], template: "<div>{{ title }}</div>" },
  MeLinkList: {
    props: ["links", "title"],
    template: '<nav><a v-for="link in links" :key="link.to" :data-testid="link.testid" :href="link.to" /></nav>'
  },
  LegalNoticeCard: { props: ["title", "tone"], template: "<section><slot /></section>" },
  LegalTableOfContents: {
    props: ["anchors"],
    template: '<nav data-testid="legal-toc"><a v-for="a in anchors" :key="a.id" :href="`#${a.id}`" /></nav>'
  }
}

const renderPage = async (kind = "terms") => {
  const host = defineComponent({
    components: { Page: LegalPage as never },
    setup: () => ({ kind }),
    template: "<Suspense><Page :kind='kind' /></Suspense>"
  })
  const wrapper = mount(host, {
    global: { stubs, config: { errorHandler: (error: unknown) => void thrown.push(error) } }
  })
  await flushPromises()
  return wrapper
}

const stateOf = (wrapper: Awaited<ReturnType<typeof renderPage>>) =>
  wrapper.get("[data-legal-state]").attributes("data-legal-state")

beforeEach(() => {
  responses.clear()
  shownErrors.length = 0
  thrown.length = 0
  seo.length = 0
  query.value = {}
  pending = false
  graphQLRequest.mockClear()
  responses.set("GetLegalText", { data: { legalText: legalDocument() } })
  responses.set("GetMyConsents", failure("UNAUTHENTICATED"))

  vi.stubGlobal("computed", computed)
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("watch", watch)
  vi.stubGlobal("useI18n", () => ({ t, locale: ref("ru") }))
  vi.stubGlobal("useRoute", () => ({ query: query.value }))
  vi.stubGlobal("useLocalePath", () => (path: string) => path)
  vi.stubGlobal("useRequestURL", () => new URL("https://altera.test/legal/terms"))
  vi.stubGlobal("useSeoMeta", (input: Record<string, unknown>) => seo.push(input))
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useGraphQL", graphQLRequest)
  vi.stubGlobal("showError", (input: unknown) => shownErrors.push(input))
  vi.stubGlobal("createError", (input: Record<string, unknown>) => Object.assign(new Error("error"), input))
  vi.stubGlobal("useAsyncData", (_key: unknown, handler: () => Promise<unknown>) => {
    const data = ref<unknown>(null)
    const error = ref<unknown>(null)
    const status = ref("pending")
    if (!pending) {
      handler().then(
        (value) => {
          data.value = value
          status.value = "success"
        },
        (thrown) => {
          error.value = thrown
          status.value = "error"
        }
      )
    }
    return { data, error, status }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("страница юридического текста: строки состояний §8", () => {
  it("«Загрузка»: при клиентском переходе показывается скелет текста", async () => {
    pending = true
    const wrapper = await renderPage()

    expect(stateOf(wrapper)).toBe("loading")
    expect(wrapper.find('[data-testid="legal-skeleton"]').exists()).toBe(true)
  })

  it("готовая страница: редакция, дата, что изменилось, оглавление, текст, архив и связанные документы", async () => {
    const wrapper = await renderPage()

    expect(stateOf(wrapper)).toBe("ready")
    expect(wrapper.get('[data-testid="legal-version"]').text()).toContain("legal.versionLine:2")
    expect(wrapper.get('[data-testid="legal-changes"]').text()).toContain("Уточнён раздел об аккаунте")
    expect(wrapper.get('[data-testid="legal-body"]').html()).toContain('id="subject"')
    expect(wrapper.find('[data-testid="legal-toc"] a[href="#subject"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="legal-archive"] a[href="/legal/terms?version=1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="legal-related-legal-privacy"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="legal-print"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="legal-previous"]').exists()).toBe(false)
  })

  it("«Пусто»: текст локали не опубликован — другая локаль с пометкой", async () => {
    responses.set("GetLegalText", {
      data: { legalText: legalDocument({ locale: "ru", requestedLocale: "en", isFallbackLocale: true }) }
    })

    const wrapper = await renderPage()

    expect(wrapper.get('[data-testid="legal-fallback"]').text()).toContain("legal.fallback")
    expect(wrapper.get('[data-testid="legal-body"]').exists()).toBe(true)
  })

  it("документ ещё не опубликован ни в одной локали — состояние «готовится», без индексации", async () => {
    responses.set("GetLegalText", { data: { legalText: null } })

    const wrapper = await renderPage()

    expect(stateOf(wrapper)).toBe("unpublished")
    expect(wrapper.get('[data-testid="legal-unpublished"]').text()).toBe("legal.unpublished.title")
    const robots = seo[0]!.robots as () => string
    expect(robots()).toBe("noindex, follow")
  })

  it("«Ошибка данных»: отказ API показывает ErrorState с кодом запроса", async () => {
    responses.set("GetLegalText", failure("INTERNAL_ERROR", "req-500"))

    const wrapper = await renderPage()

    expect(stateOf(wrapper)).toBe("error")
    expect(wrapper.get('[data-testid="legal-error"]').text()).toBe("req-500")
  })

  it("«Не найдено»: неизвестная редакция — страница 404", async () => {
    query.value = { version: "7" }
    responses.set("GetLegalText", failure("NOT_FOUND"))

    await renderPage()

    expect(shownErrors).toEqual([expect.objectContaining({ statusCode: 404 })])
  })

  it("«Не найдено»: номер редакции не число — 404 без запроса к API", async () => {
    query.value = { version: "abc" }

    await renderPage()

    expect(thrown[0]).toMatchObject({ statusCode: 404 })
    expect(graphQLRequest.mock.calls.some(([document]) => operationName(document) === "GetLegalText")).toBe(false)
  })

  it("прежняя редакция по ?version= показывает плашку и не индексируется", async () => {
    query.value = { version: "1" }
    responses.set("GetLegalText", {
      data: { legalText: legalDocument({ version: 1, isCurrent: false, isMaterial: false }) }
    })

    const wrapper = await renderPage()

    expect(wrapper.get('[data-testid="legal-previous"]').text()).toContain("legal.previous:1,2")
    expect(wrapper.find('[data-testid="legal-current-link"]').attributes("href")).toBe("/legal/terms")
    expect((seo[0]!.robots as () => string)()).toBe("noindex, follow")
  })

  it("аккаунт видит принятую редакцию и пометку о повторном согласии", async () => {
    responses.set("GetMyConsents", {
      data: {
        me: {
          id: "user-1",
          consents: [
            {
              kind: "terms",
              locale: "ru",
              currentVersion: 2,
              acceptedVersion: 1,
              acceptedAt: "2026-09-02T00:00:00.000Z",
              reconsentRequired: true
            }
          ]
        }
      }
    })

    const wrapper = await renderPage()

    expect(wrapper.get('[data-testid="legal-consent"]').text()).toContain("legal.consent.accepted:1")
    expect(wrapper.find('[data-testid="legal-reconsent"]').exists()).toBe(true)
  })

  it("«Заблокирован»: архивированный аккаунт читает как гость", async () => {
    responses.set("GetMyConsents", failure("FORBIDDEN"))

    const wrapper = await renderPage()

    expect(stateOf(wrapper)).toBe("ready")
    expect(wrapper.find('[data-testid="legal-consent"]').exists()).toBe(false)
  })
})

/** Заглушка `LegalPage` для страниц видов: отдаёт слотам документ и роль читателя. */
const pageWith = (document: Record<string, unknown>, viewer: string) =>
  defineComponent({
    setup:
      (_props, { slots }) =>
      () =>
        h("div", [slots.summary?.({ document, viewer }), slots["after-text"]?.({ document, viewer })])
  })

describe("страницы видов", () => {
  const mountKind = (component: unknown, document: Record<string, unknown>, viewer: string) =>
    mount(component as never, {
      global: { stubs: { ...stubs, LegalPage: pageWith(document, viewer) } }
    })

  it("лицензия всегда содержит запрет обучения ИИ (журнал §24.2) и блок «коротко»", () => {
    const wrapper = mountKind(LicensePage, legalDocument({ kind: "license", anchors: [] }), "guest")

    const section = wrapper.get('[data-testid="legal-ai-training"]')
    expect(section.attributes("id")).toBe("ai-training")
    expect(section.text()).toContain("legal.license.aiTraining.ban")
    expect(wrapper.findAll('[data-testid="legal-license-summary"] section')).toHaveLength(3)
  })

  it("раздел об обучении ИИ из самого текста не дублируется", () => {
    const wrapper = mountKind(
      LicensePage,
      legalDocument({ kind: "license", anchors: [{ id: "ai-training", title: "Обучение ИИ" }] }),
      "guest"
    )

    expect(wrapper.find('[data-testid="legal-ai-training"]').exists()).toBe(false)
  })

  it("политика ПД: «ваши данные» — ссылки для аккаунта, только связь для архивированного, ничего гостю", () => {
    const account = mountKind(PrivacyPage, legalDocument({ kind: "privacy" }), "account")
    expect(account.find('[data-testid="legal-your-data-export"]').attributes("href")).toBe("/me/export")
    expect(account.find('[data-testid="legal-your-data-delete"]').exists()).toBe(true)

    const archived = mountKind(PrivacyPage, legalDocument({ kind: "privacy" }), "archived")
    expect(archived.find('[data-testid="legal-your-data-contact"]').exists()).toBe(true)
    expect(archived.find('[data-testid="legal-your-data-export"]').exists()).toBe(false)

    const guest = mountKind(PrivacyPage, legalDocument({ kind: "privacy" }), "guest")
    expect(guest.find('[data-testid="legal-your-data"]').exists()).toBe(false)
  })
})

describe("правила страниц юридических текстов", () => {
  it("разбирает номер редакции из адреса", () => {
    expect(legalVersionParam(undefined)).toBeUndefined()
    expect(legalVersionParam("")).toBeUndefined()
    expect(legalVersionParam("3")).toBe(3)
    expect(legalVersionParam(["2", "5"])).toBe(2)
    expect(legalVersionParam("0")).toBeNull()
    expect(legalVersionParam("1.5")).toBeNull()
    expect(legalVersionParam("abc")).toBeNull()
  })

  it("показывает согласие только у оферты и политики ПД", () => {
    const consents = [
      { kind: "terms", acceptedVersion: 2, reconsentRequired: false },
      { kind: "privacy", acceptedVersion: null, reconsentRequired: true }
    ]
    expect(consentFor("terms", consents)).toMatchObject({ acceptedVersion: 2 })
    expect(consentFor("privacy", consents)).toBeNull()
    expect(consentFor("license", consents)).toBeNull()
  })

  it("отличает архивированный аккаунт от гостя по коду отказа", () => {
    expect(legalViewerFromCode("FORBIDDEN")).toBe("archived")
    expect(legalViewerFromCode("UNAUTHENTICATED")).toBe("guest")
    expect(legalViewerFromCode(undefined)).toBe("guest")
  })

  it("форматирует дату редакции без времени и сдвига часового пояса", () => {
    expect(formatLegalDate("2026-09-01T00:00:00.000Z", "ru")).toBe("1 сентября 2026 г.")
    expect(formatLegalDate("2026-09-01T00:00:00.000Z", "en")).toBe("1 September 2026")
    expect(formatLegalDate("not a date", "ru")).toBe("")
  })

  it("адрес правил публикации пишется через дефис", () => {
    expect(LEGAL_PATHS.content_rules).toBe("/legal/content-rules")
  })
})
