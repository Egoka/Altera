// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { computed, defineComponent, onBeforeUnmount, ref, watch } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AboutPage from "../app/pages/about.vue"
import ContactPage from "../app/pages/contact.vue"
import ContactForm from "../app/components/contact/ContactForm.vue"
import FeatureColumns from "../app/components/about/FeatureColumns.vue"
import NoticeCard from "../app/components/legal/NoticeCard.vue"

// Строки состояний §8 `about.md` и `contact.md` в юнит-среде; браузерные — `e2e/59-about-contact.spec.ts`.

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${Object.values(params).join(",")}` : key

const stubs = {
  NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
  ReadingErrorState: {
    props: ["requestId", "title", "description"],
    template: '<section data-zone="error-state">{{ title }} {{ requestId }}</section>'
  },
  ReadingEmptyState: {
    props: ["title", "description"],
    template: '<section data-zone="empty-state">{{ title }}</section>'
  }
}

const components = {
  ContactForm,
  AboutFeatureColumns: FeatureColumns,
  LegalNoticeCard: NoticeCard
}

const graphQLRequest = vi.fn()
const fetchRequest = vi.fn()
const routeQuery = ref<Record<string, unknown>>({})

const render = async (component: unknown) => {
  const host = defineComponent({
    components: { Page: component as never },
    template: "<Suspense><Page /></Suspense>"
  })
  const wrapper = mount(host, { global: { stubs, components } })
  await flushPromises()
  return wrapper
}

let asyncStatus = "success"

beforeEach(() => {
  graphQLRequest.mockReset()
  fetchRequest.mockReset()
  routeQuery.value = {}
  asyncStatus = "success"
  vi.stubGlobal("computed", computed)
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("watch", watch)
  vi.stubGlobal("onBeforeUnmount", onBeforeUnmount)
  vi.stubGlobal("useI18n", () => ({ t, locale: ref("ru") }))
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("useSeoMeta", vi.fn())
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useLocalePath", () => (path: string) => path)
  vi.stubGlobal("useRoute", () => ({ query: routeQuery.value, params: {} }))
  vi.stubGlobal("useRequestURL", () => new URL("http://altera.test/contact"))
  vi.stubGlobal("useRequestEvent", () => null)
  vi.stubGlobal("setResponseStatus", vi.fn())
  vi.stubGlobal("useGraphQL", graphQLRequest)
  vi.stubGlobal("$fetch", fetchRequest)
  vi.stubGlobal("useAsyncData", (_key: unknown, handler: () => Promise<unknown>) => {
    const data = ref<unknown>(null)
    const error = ref<unknown>(null)
    const status = ref(asyncStatus)
    const promise =
      asyncStatus === "pending"
        ? Promise.resolve()
        : handler().then(
            (value) => void (data.value = value),
            (thrown) => {
              error.value = thrown
              status.value = "error"
            }
          )
    return Object.assign(
      promise.then(() => ({ data, error, status })),
      { data, error, status }
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ——— «Письмо в редакцию» ———

const guest = { errors: [{ extensions: { code: "UNAUTHENTICATED" } }] }
const account = { data: { me: { id: "user-1", email: "reader@example.test", isArchived: false } } }
const archived = { data: { me: { id: "user-1", email: "reader@example.test", isArchived: true } } }

const fillGuest = async (wrapper: Awaited<ReturnType<typeof render>>) => {
  await wrapper.get('[data-testid="contact-email"]').setValue("guest@example.test")
  await wrapper.get('[data-testid="contact-message"]').setValue("Здравствуйте, у меня вопрос о журнале.")
  await wrapper.get('[data-testid="contact-consent"]').setValue(true)
}

const submit = async (wrapper: Awaited<ReturnType<typeof render>>) => {
  await wrapper.get('[data-testid="contact-form"]').trigger("submit")
  await flushPromises()
}

describe("страница «Письмо в редакцию»", () => {
  it("гость видит адрес, согласие и тему «общий вопрос» по умолчанию", async () => {
    graphQLRequest.mockResolvedValue(guest)

    const wrapper = await render(ContactPage)

    expect(wrapper.find('[data-testid="contact-email"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="contact-consent"]').exists()).toBe(true)
    expect((wrapper.get('[data-testid="contact-topic"]').element as HTMLSelectElement).value).toBe("general")
    expect(wrapper.get('[data-testid="contact-requisites"]').text()).toContain("contact.requisites.text")
  })

  it("аккаунт пишет с адреса сессии: поля адреса и согласия нет", async () => {
    graphQLRequest.mockResolvedValue(account)

    const wrapper = await render(ContactPage)

    expect(wrapper.find('[data-testid="contact-email"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="contact-consent"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="contact-account-email"]').text()).toContain("reader@example.test")
  })

  it("строка «Заблокирован»: архивированный аккаунт видит обычную форму гостя", async () => {
    graphQLRequest.mockResolvedValue(archived)
    routeQuery.value = { topic: "restore" }

    const wrapper = await render(ContactPage)

    expect(wrapper.find('[data-testid="contact-email"]').exists()).toBe(true)
    expect((wrapper.get('[data-testid="contact-topic"]').element as HTMLSelectElement).value).toBe("restore")
  })

  it("предзаполняет тему, путь и requestId из адреса; неизвестная тема — «другое»", async () => {
    graphQLRequest.mockResolvedValue(guest)
    routeQuery.value = { topic: "broken_link", path: "/a/b?x=1", requestId: "t058-request-id" }

    const wrapper = await render(ContactPage)

    expect((wrapper.get('[data-testid="contact-topic"]').element as HTMLSelectElement).value).toBe("broken_link")
    expect(wrapper.get('[data-testid="contact-path-line"]').text()).toContain("/a/b")
    expect(wrapper.get('[data-testid="contact-request-id"]').text()).toContain("t058-request-id")

    routeQuery.value = { topic: "privacy" }
    const other = await render(ContactPage)
    expect((other.get('[data-testid="contact-topic"]').element as HTMLSelectElement).value).toBe("other")
  })

  it("ошибки полей показываются до отправки и запрос не уходит", async () => {
    graphQLRequest.mockResolvedValue(guest)

    const wrapper = await render(ContactPage)
    await submit(wrapper)

    expect(wrapper.find('[data-testid="contact-email-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="contact-message-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="contact-consent-error"]').exists()).toBe(true)
    expect(fetchRequest).not.toHaveBeenCalled()
  })

  it("после отправки — номер обращения и адрес ответа; requestId уходит в обращение", async () => {
    graphQLRequest.mockResolvedValue(guest)
    routeQuery.value = { requestId: "t058-request-id" }
    fetchRequest.mockResolvedValue({ data: { createSupportRequest: { ok: true, ticketNo: 42 } } })

    const wrapper = await render(ContactPage)
    await fillGuest(wrapper)
    await submit(wrapper)

    expect(wrapper.get('[data-testid="contact-sent"]').text()).toContain("contact.sent.title:42")
    expect(wrapper.get('[data-testid="contact-sent"]').text()).toContain("guest@example.test")
    expect(fetchRequest.mock.calls[0]![1].body.variables).toMatchObject({
      topic: "general",
      email: "guest@example.test",
      requestId: "t058-request-id",
      acceptPrivacy: true
    })
  })

  it("строка «Ограничение»: RATE_LIMITED показывает таймер и блокирует кнопку", async () => {
    graphQLRequest.mockResolvedValue(guest)
    fetchRequest.mockResolvedValue({ errors: [{ extensions: { code: "RATE_LIMITED", retryAfter: 125 } }] })

    const wrapper = await render(ContactPage)
    await fillGuest(wrapper)
    await submit(wrapper)

    expect(wrapper.get('[data-testid="contact-limited"]').text()).toContain("2:05")
    expect(wrapper.get('[data-testid="contact-submit"]').attributes("disabled")).toBeDefined()
    wrapper.unmount()
  })

  it("строка «Ошибка данных»: ErrorState с кодом запроса, текст остаётся в поле", async () => {
    graphQLRequest.mockResolvedValue(guest)
    fetchRequest.mockResolvedValue({ errors: [{ extensions: { code: "INTERNAL_ERROR", requestId: "req-500" } }] })

    const wrapper = await render(ContactPage)
    await fillGuest(wrapper)
    await submit(wrapper)

    expect(wrapper.get('[data-testid="contact-error"]').text()).toContain("req-500")
    expect((wrapper.get('[data-testid="contact-message"]').element as HTMLTextAreaElement).value).toContain(
      "вопрос о журнале"
    )
  })

  it("тема «возврат» подсказывает кабинет", async () => {
    graphQLRequest.mockResolvedValue(account)
    routeQuery.value = { topic: "refund" }

    const wrapper = await render(ContactPage)

    expect(wrapper.get('[data-testid="contact-refund-link"]').attributes("href")).toBe("/me/subscription")
  })
})

// ——— «О проекте» ———

const aboutText = (overrides: Record<string, unknown> = {}) => ({
  kind: "about",
  locale: "ru",
  requestedLocale: "ru",
  isFallbackLocale: false,
  version: 2,
  publishedAt: "2026-09-20T00:00:00.000Z",
  html: "<p>Проект развивается.</p>",
  availableLocales: ["ru"],
  ...overrides
})

const sectionsOf = (...counts: number[]) =>
  counts.map((count, index) => ({
    slug: `s${index}`,
    name: `Рубрика ${index}`,
    description: null,
    articleCount: count
  }))

const mockAbout = (page: unknown, role: string | null = null) =>
  graphQLRequest.mockImplementation(async (document: { definitions: { name?: { value: string } }[] }) =>
    document.definitions[0]?.name?.value === "GetAboutViewer"
      ? role
        ? { data: { me: { id: "u", role } } }
        : { errors: [{ extensions: { code: "UNAUTHENTICATED" } }] }
      : page
  )

describe("страница «О проекте»", () => {
  it("показывает статические зоны, текст владельца и только непустые рубрики", async () => {
    mockAbout({ data: { staticText: aboutText(), sectionCatalog: sectionsOf(3, 0, 1) } })

    const wrapper = await render(AboutPage)

    expect(wrapper.get('[data-testid="about-lead"]').text()).toContain("about.lead")
    expect(wrapper.findAll('[data-testid^="about-column-"]')).toHaveLength(3)
    expect(wrapper.get('[data-testid="about-body"]').html()).toContain("Проект развивается.")
    expect(wrapper.findAll('[data-testid="about-sections"] li')).toHaveLength(2)
    expect(wrapper.get('[data-testid="about-cta-pricing"]').attributes("href")).toBe("/pricing")
    expect(wrapper.get('[data-testid="about-cta-contact"]').attributes("href")).toBe("/contact")
    expect(wrapper.find('[data-testid="about-edit"]').exists()).toBe(false)
  })

  it("строка «Пусто»: другая локаль с пометкой, owner видит подсказку и ссылку", async () => {
    mockAbout(
      { data: { staticText: aboutText({ locale: "en", isFallbackLocale: true }), sectionCatalog: [] } },
      "owner"
    )

    const wrapper = await render(AboutPage)

    expect(wrapper.find('[data-testid="about-fallback"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="about-owner-hint"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="about-edit"]').attributes("href")).toBe("/admin/legal/about")
    // Пустая база: зона «О чём пишем» скрыта (§12).
    expect(wrapper.find('[data-testid="about-sections"]').exists()).toBe(false)
  })

  it("текст не опубликован ни в одной локали — состояние «готовится»", async () => {
    mockAbout({ data: { staticText: null, sectionCatalog: [] } })

    const wrapper = await render(AboutPage)

    expect(wrapper.get('[data-zone="empty-state"]').text()).toContain("about.text.unpublishedTitle")
  })

  it("строка «Ошибка данных»: ErrorState, зоны 2 и 7 остаются", async () => {
    mockAbout({ errors: [{ extensions: { code: "INTERNAL_ERROR", requestId: "about-req" } }] })

    const wrapper = await render(AboutPage)

    expect(wrapper.find('[data-zone="error-state"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="about-lead"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="about-cta"]').exists()).toBe(true)
  })

  it("строка «Загрузка»: скелет текста", async () => {
    asyncStatus = "pending"
    mockAbout({ data: null })

    const wrapper = await render(AboutPage)

    expect(wrapper.find('[data-testid="about-skeleton"]').exists()).toBe(true)
  })
})
