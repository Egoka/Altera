// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { computed, defineComponent, ref, watch } from "vue"
import { Kind, type DocumentNode } from "graphql"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import SessionsPage from "../app/pages/me/sessions.vue"

// Строки состояний `docs/spec/30-account/reader/sessions.md` §8 и действия §7.

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${Object.values(params).join(",")}` : key

const operationName = (document: DocumentNode): string => {
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) return definition.name?.value ?? ""
  }
  return ""
}

const session = (overrides: Record<string, unknown> = {}) => ({
  id: "session-current",
  deviceClass: "desktop",
  browserClass: "chrome",
  createdAt: "2026-09-18T09:00:00.000Z",
  lastActiveAt: "2026-09-21T11:59:00.000Z",
  isCurrent: true,
  ...overrides
})

const phone = () =>
  session({
    id: "session-phone",
    deviceClass: "mobile",
    browserClass: "safari",
    lastActiveAt: "2026-09-21T10:00:00.000Z",
    isCurrent: false
  })

const failure = (extensions: Record<string, unknown>) => ({ data: null, errors: [{ extensions }] })
const listOf = (...sessions: unknown[]) => ({ data: { me: { id: "user-1", sessions } } })

const responses = new Map<string, unknown>()
const navigations: unknown[] = []
const graphQLRequest = vi.fn(async (document: DocumentNode) => {
  const name = operationName(document)
  const response = responses.get(name)
  if (typeof response === "function") return (response as () => unknown)()
  return response ?? failure({ code: "INTERNAL_ERROR" })
})

const stubs = {
  NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
  ConfirmDialog: {
    props: ["open", "title", "confirmLabel", "cancelLabel", "busy", "body", "testid"],
    emits: ["confirm", "cancel"],
    template:
      '<div v-if="open" data-testid="sessions-confirm"><button data-testid="confirm-yes" @click="$emit(\'confirm\')">{{ confirmLabel }}</button><button data-testid="confirm-no" @click="$emit(\'cancel\')" /></div>'
  }
}

const render = async () => {
  const host = defineComponent({
    components: { Page: SessionsPage as never },
    template: "<Suspense><Page /></Suspense>"
  })
  const wrapper = mount(host, { global: { stubs } })
  await flushPromises()
  return wrapper
}

const stateOf = (wrapper: Awaited<ReturnType<typeof render>>) =>
  wrapper.get("[data-sessions-state]").attributes("data-sessions-state")

beforeEach(() => {
  responses.clear()
  navigations.length = 0
  graphQLRequest.mockClear()
  responses.set("GetMySessions", listOf(session(), phone()))
  responses.set("RevokeSession", { data: { revokeSession: { revoked: true } } })
  responses.set("RevokeAllSessions", { data: { revokeAllSessions: { revokedCount: 1 } } })
  responses.set("LogoutSession", { data: { logout: true } })

  vi.stubGlobal("computed", computed)
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("watch", watch)
  vi.stubGlobal("useI18n", () => ({ t, locale: ref("ru") }))
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useGraphQL", graphQLRequest)
  vi.stubGlobal("navigateTo", async (target: unknown) => {
    navigations.push(target)
  })
  vi.stubGlobal("createError", (input: unknown) => new Error(JSON.stringify(input)))
  vi.stubGlobal("useAsyncData", async (_key: unknown, handler: () => Promise<unknown>) => {
    const data = ref<unknown>(null)
    const error = ref<unknown>(null)
    const status = ref("success")
    const refresh = async () => {
      try {
        data.value = await handler()
        error.value = null
        status.value = "success"
      } catch (thrown) {
        error.value = thrown
        status.value = "error"
      }
    }
    await refresh()
    return { data, error, status, refresh }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("страница сессий: строки состояний §8", () => {
  it("«Загрузка»: пока список не получен, показывается скелет", async () => {
    vi.stubGlobal("useAsyncData", async () => ({
      data: ref(null),
      error: ref(null),
      status: ref("pending"),
      refresh: vi.fn()
    }))

    const wrapper = await render()

    expect(stateOf(wrapper)).toBe("loading")
    expect(wrapper.find('[data-testid="sessions-skeleton"]').exists()).toBe(true)
  })

  it("«Пусто»: одна текущая сессия скрывает «выйти везде» и показывает пустое состояние", async () => {
    responses.set("GetMySessions", listOf(session()))

    const wrapper = await render()

    expect(stateOf(wrapper)).toBe("ready")
    expect(wrapper.find('[data-testid="sessions-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sessions-logout-all"]').exists()).toBe(false)
  })

  it("«Ошибка данных»: отказ чтения показывает сообщение и кнопку повтора", async () => {
    responses.set("GetMySessions", failure({ code: "INTERNAL_ERROR", requestId: "req-1" }))

    const wrapper = await render()

    expect(stateOf(wrapper)).toBe("data_error")
    expect(wrapper.find('[data-testid="sessions-retry"]').exists()).toBe(true)
  })

  it("«Нет доступа»: без сессии страница уводит на вход с путём возврата", async () => {
    responses.set("GetMySessions", failure({ code: "UNAUTHENTICATED" }))

    await render()

    expect(navigations[0]).toMatchObject({ path: "/login", query: { next: "/me/sessions" } })
  })

  it("«Заблокирован»: ограниченная сессия уходит на экран состояния", async () => {
    responses.set("GetMySessions", failure({ code: "FORBIDDEN" }))

    await render()

    expect(navigations[0]).toBe("/me/archived")
  })

  it("«Не найдено»: отзыв уже отозванной убирает строку и сообщает, что сессия завершена", async () => {
    responses.set("RevokeSession", failure({ code: "NOT_FOUND" }))

    const wrapper = await render()
    await wrapper.get('[data-testid="session-row-session-phone"] [data-testid="session-revoke"]').trigger("click")
    await flushPromises()

    expect(wrapper.find('[data-testid="session-row-session-phone"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="sessions-notice"]').text()).toBe("account.sessions.alreadyRevoked")
    expect(wrapper.find('[data-testid="sessions-error"]').exists()).toBe(false)
  })
})

describe("страница сессий: зоны и действия §5, §7", () => {
  it("показывает классы устройства и браузера и не раскрывает адрес или user-agent", async () => {
    const wrapper = await render()
    const current = wrapper.get('[data-testid="session-row-session-current"]')

    expect(current.attributes("data-session-current")).toBe("true")
    expect(current.get('[data-testid="session-device"]').text()).toBe(
      "account.sessions.device.desktop · account.sessions.browser.chrome"
    )
    expect(current.get('[data-testid="session-activity"]').text()).toContain("account.sessions.now")
    expect(wrapper.text()).not.toContain("Mozilla")
  })

  it("у текущей сессии кнопка «выйти», у остальных — «отозвать»", async () => {
    const wrapper = await render()

    expect(wrapper.find('[data-testid="session-row-session-current"] [data-testid="session-logout"]').exists()).toBe(
      true
    )
    expect(wrapper.find('[data-testid="session-row-session-current"] [data-testid="session-revoke"]').exists()).toBe(
      false
    )
    expect(wrapper.find('[data-testid="session-row-session-phone"] [data-testid="session-revoke"]').exists()).toBe(true)
  })

  it("отзыв убирает строку другого устройства и оставляет текущую", async () => {
    const wrapper = await render()
    await wrapper.get('[data-testid="session-row-session-phone"] [data-testid="session-revoke"]').trigger("click")
    await flushPromises()

    expect(wrapper.find('[data-testid="session-row-session-phone"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="session-row-session-current"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="sessions-notice"]').text()).toBe("account.sessions.revoked")
  })

  it("«выйти везде» спрашивает подтверждение и оставляет только текущую сессию", async () => {
    const wrapper = await render()

    expect(wrapper.find('[data-testid="sessions-confirm"]').exists()).toBe(false)
    await wrapper.get('[data-testid="sessions-logout-all"]').trigger("click")
    expect(wrapper.find('[data-testid="sessions-confirm"]').exists()).toBe(true)

    await wrapper.get('[data-testid="confirm-yes"]').trigger("click")
    await flushPromises()

    expect(graphQLRequest.mock.calls.map(([document]) => operationName(document))).toContain("RevokeAllSessions")
    expect(wrapper.find('[data-testid="session-row-session-phone"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="sessions-notice"]').text()).toBe("account.sessions.revokedAll:1")
    expect(wrapper.find('[data-testid="sessions-logout-all"]').exists()).toBe(false)
  })

  it("отмена подтверждения ничего не отзывает", async () => {
    const wrapper = await render()
    await wrapper.get('[data-testid="sessions-logout-all"]').trigger("click")
    await wrapper.get('[data-testid="confirm-no"]').trigger("click")
    await flushPromises()

    expect(graphQLRequest.mock.calls.map(([document]) => operationName(document))).not.toContain("RevokeAllSessions")
    expect(wrapper.find('[data-testid="session-row-session-phone"]').exists()).toBe(true)
  })

  it("«выйти» вызывает logout и уходит на главную полным переходом", async () => {
    const wrapper = await render()
    await wrapper.get('[data-testid="session-row-session-current"] [data-testid="session-logout"]').trigger("click")
    await flushPromises()

    expect(graphQLRequest.mock.calls.map(([document]) => operationName(document))).toContain("LogoutSession")
    expect(navigations.at(-1)).toBe("/")
  })

  it("зона безопасности ведёт на смену почты и в редакцию", async () => {
    const wrapper = await render()

    expect(wrapper.get('[data-testid="sessions-change-email"]').attributes("href")).toBe("/me/email")
    expect(wrapper.get('[data-testid="sessions-contact"]').attributes("href")).toContain("/contact")
  })
})
