// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { computed, defineComponent, ref, watch } from "vue"
import { Kind, type DocumentNode } from "graphql"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ArchivedPage from "../app/pages/me/archived.vue"
import ConfirmArchivePage from "../app/pages/me/delete/confirm.vue"
import DeleteAccountPage from "../app/pages/me/delete/index.vue"

// Строки состояний `docs/spec/30-account/reader/delete-account.md` §8 и `archived-state.md` §8,
// действия — §7 обеих страниц.

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${Object.values(params).join(",")}` : key

const operationName = (document: DocumentNode): string => {
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) return definition.name?.value ?? ""
  }
  return ""
}

const failure = (extensions: Record<string, unknown>) => ({ data: null, errors: [{ extensions }] })

const preview = (overrides: Record<string, unknown> = {}) => ({
  articlesCount: 2,
  isLastOwner: false,
  plan: { state: "base", tier: "standard", until: null, endedAt: null, queue: [] },
  pending: null,
  ...overrides
})

const previewOf = (overrides: Record<string, unknown> = {}) => ({
  data: { me: { id: "user-1", role: "author", archivePreview: preview(overrides) } }
})

const archiveState = (overrides: Record<string, unknown> = {}) => ({
  data: {
    me: {
      id: "user-1",
      name: "Автор",
      archiveState: {
        archivedAt: "2026-09-20T10:00:00.000Z",
        mode: "self",
        articlesArchived: 2,
        canRestore: true,
        plan: { state: "base", tier: "standard", until: null, endedAt: null, queue: [] },
        ...overrides
      }
    }
  }
})

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
  AppHeader: { template: "<header />" },
  AppFooter: { template: "<footer />" },
  AppMain: { template: "<main><slot /></main>" },
  SubscriptionStatus: { props: ["subscription"], template: '<div data-testid="archived-plan" />' },
  ConfirmDialog: {
    props: ["open", "title", "body", "confirmLabel", "cancelLabel", "busy", "testid"],
    emits: ["confirm", "cancel"],
    template:
      '<div v-if="open" data-testid="archived-confirm"><button data-testid="confirm-yes" @click="$emit(\'confirm\')" /><button data-testid="confirm-no" @click="$emit(\'cancel\')" /></div>'
  }
}

const render = async (page: unknown) => {
  const host = defineComponent({
    components: { Page: page as never },
    template: "<Suspense><Page /></Suspense>"
  })
  const wrapper = mount(host, { global: { stubs } })
  await flushPromises()
  return wrapper
}

const routeQuery = ref<Record<string, unknown>>({})

beforeEach(() => {
  responses.clear()
  navigations.length = 0
  graphQLRequest.mockClear()
  routeQuery.value = { token: "a".repeat(64) }
  responses.set("GetAccountArchivePreview", previewOf())
  responses.set("GetAccountArchiveState", archiveState())
  responses.set("RequestAccountArchive", { data: { requestAccountArchive: preview() } })
  responses.set("CancelAccountArchive", { data: { cancelAccountArchive: preview() } })
  responses.set("ConfirmAccountArchive", { data: { confirmAccountArchive: { archived: true, articlesArchived: 2 } } })
  responses.set("RestoreAccountSelf", {
    data: {
      restoreAccountSelf: {
        restored: true,
        session: { accessToken: "access", refreshToken: null, user: { id: "user-1" } }
      }
    }
  })

  vi.stubGlobal("computed", computed)
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("watch", watch)
  vi.stubGlobal("useI18n", () => ({ t, locale: ref("ru") }))
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useRoute", () => ({ query: routeQuery.value }))
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

describe("страница «Удалить аккаунт»: строки §8", () => {
  const stateOf = (wrapper: Awaited<ReturnType<typeof render>>) =>
    wrapper.get("[data-delete-account-state]").attributes("data-delete-account-state")

  it("«Загрузка»: пока предпросмотр не получен, показывается скелет", async () => {
    vi.stubGlobal("useAsyncData", async () => ({
      data: ref(null),
      error: ref(null),
      status: ref("pending"),
      refresh: vi.fn()
    }))

    const wrapper = await render(DeleteAccountPage)

    expect(stateOf(wrapper)).toBe("loading")
    expect(wrapper.find('[data-testid="delete-account-skeleton"]').exists()).toBe(true)
  })

  it("«Ошибка данных»: предпросмотр не получен — сообщение и повтор", async () => {
    responses.set("GetAccountArchivePreview", failure({ code: "INTERNAL_ERROR", requestId: "req-1" }))

    const wrapper = await render(DeleteAccountPage)

    expect(stateOf(wrapper)).toBe("data_error")
    expect(wrapper.find('[data-testid="delete-account-retry"]').exists()).toBe(true)
  })

  it("показывает последствия, число материалов и единственный вариант судьбы", async () => {
    const wrapper = await render(DeleteAccountPage)

    expect(stateOf(wrapper)).toBe("ready")
    expect(wrapper.get('[data-testid="delete-account-articles"]').text()).toBe("account.delete.articlesCount:2")
    expect(wrapper.findAll('[data-testid="delete-account-fate"] input')).toHaveLength(1)
    expect(wrapper.get('[data-testid="delete-account-export"]').attributes("href")).toBe("/me/export")
    expect(wrapper.find('[data-testid="delete-account-send"]').exists()).toBe(true)
  })

  it("без материалов зона 4 говорит, что в архив уйдёт только аккаунт", async () => {
    responses.set("GetAccountArchivePreview", previewOf({ articlesCount: 0 }))

    const wrapper = await render(DeleteAccountPage)

    expect(wrapper.get('[data-testid="delete-account-articles"]').text()).toBe("account.delete.articlesNone")
  })

  it("«Нет доступа»: гость уходит на вход с путём возврата", async () => {
    responses.set("GetAccountArchivePreview", failure({ code: "UNAUTHENTICATED" }))

    await render(DeleteAccountPage)

    expect(navigations[0]).toMatchObject({ path: "/login", query: { next: "/me/delete" } })
  })

  it("«Заблокирован»: ограниченная сессия уходит на экран состояния", async () => {
    responses.set("GetAccountArchivePreview", failure({ code: "FORBIDDEN" }))

    await render(DeleteAccountPage)

    expect(navigations[0]).toBe("/me/archived")
  })

  it("«Заблокирован»: последний владелец видит требование назначить другого", async () => {
    responses.set("GetAccountArchivePreview", previewOf({ isLastOwner: true }))

    const wrapper = await render(DeleteAccountPage)

    expect(wrapper.find('[data-testid="delete-account-last-owner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="delete-account-send"]').exists()).toBe(false)
  })

  it("после запроса показывает срок ссылки и предлагает отменить", async () => {
    const pending = { requestedAt: "2026-09-27T10:00:00.000Z", expiresAt: "2099-01-01T11:00:00.000Z" }
    responses.set("RequestAccountArchive", { data: { requestAccountArchive: preview({ pending }) } })

    const wrapper = await render(DeleteAccountPage)
    await wrapper.get('[data-testid="delete-account-send"]').trigger("click")
    await flushPromises()

    expect(wrapper.find('[data-testid="delete-account-pending"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="delete-account-cancel"]').exists()).toBe(true)

    await wrapper.get('[data-testid="delete-account-cancel"]').trigger("click")
    await flushPromises()

    expect(wrapper.find('[data-testid="delete-account-cancelled"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="delete-account-send"]').exists()).toBe(true)
  })

  it("истёкшая ссылка не удерживает экран в состоянии ожидания", async () => {
    const pending = { requestedAt: "2026-09-27T09:00:00.000Z", expiresAt: "2020-01-01T00:00:00.000Z" }
    responses.set("GetAccountArchivePreview", previewOf({ pending }))

    const wrapper = await render(DeleteAccountPage)

    expect(wrapper.find('[data-testid="delete-account-pending"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="delete-account-send"]').exists()).toBe(true)
  })

  it("«Ограничение»: лимит одного письма в сутки называет время следующей попытки", async () => {
    responses.set("RequestAccountArchive", failure({ code: "RATE_LIMITED", retryAfter: 3600 }))

    const wrapper = await render(DeleteAccountPage)
    await wrapper.get('[data-testid="delete-account-send"]').trigger("click")
    await flushPromises()

    expect(wrapper.get('[data-testid="delete-account-error"]').text()).toBe("account.delete.error.rateLimited:60")
  })

  it("«Конфликт»: открытый запрос называет причину отдельной строкой", async () => {
    responses.set("RequestAccountArchive", failure({ code: "CONFLICT", entity: "accountArchive" }))

    const wrapper = await render(DeleteAccountPage)
    await wrapper.get('[data-testid="delete-account-send"]').trigger("click")
    await flushPromises()

    expect(wrapper.get('[data-testid="delete-account-error"]').text()).toBe("account.delete.error.openRequest")
  })
})

describe("страница подтверждения: строки §8", () => {
  const stateOf = (wrapper: Awaited<ReturnType<typeof render>>) =>
    wrapper.get("[data-confirm-archive-state]").attributes("data-confirm-archive-state")

  it("требует ввод слова перед подтверждением", async () => {
    const wrapper = await render(ConfirmArchivePage)

    expect(stateOf(wrapper)).toBe("form")
    expect(wrapper.get('[data-testid="confirm-archive-submit"]').attributes("disabled")).toBeDefined()

    await wrapper.get('[data-testid="confirm-archive-word"]').setValue("account.delete.confirm.word")

    expect(wrapper.get('[data-testid="confirm-archive-submit"]').attributes("disabled")).toBeUndefined()
  })

  it("после подтверждения показывает сообщение об архиве и уход на главную", async () => {
    const wrapper = await render(ConfirmArchivePage)
    await wrapper.get('[data-testid="confirm-archive-word"]').setValue("account.delete.confirm.word")
    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(stateOf(wrapper)).toBe("done")
    expect(wrapper.get('[data-testid="confirm-archive-home"]').attributes("href")).toBe("/")
  })

  it("«Не найдено»: истёкшая ссылка предлагает запросить письмо заново", async () => {
    responses.set("ConfirmAccountArchive", failure({ code: "NOT_FOUND", entity: "accountArchive" }))

    const wrapper = await render(ConfirmArchivePage)
    await wrapper.get('[data-testid="confirm-archive-word"]').setValue("account.delete.confirm.word")
    await wrapper.get("form").trigger("submit")
    await flushPromises()

    expect(stateOf(wrapper)).toBe("invalid")
    expect(wrapper.get('[data-testid="confirm-archive-restart"]').attributes("href")).toBe("/me/delete")
  })

  it("ссылка без токена сразу показывает «недействительна»", async () => {
    routeQuery.value = {}

    const wrapper = await render(ConfirmArchivePage)

    expect(stateOf(wrapper)).toBe("invalid")
  })
})

describe("экран состояния архива: строки §8", () => {
  const stateOf = (wrapper: Awaited<ReturnType<typeof render>>) =>
    wrapper.get("[data-archived-state]").attributes("data-archived-state")

  it("показывает дату архива, число статей, план и напоминание про материалы", async () => {
    const wrapper = await render(ArchivedPage)

    expect(stateOf(wrapper)).toBe("ready")
    expect(wrapper.get('[data-testid="archived-articles"]').text()).toBe("account.archived.articles:2")
    expect(wrapper.find('[data-testid="archived-plan"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="archived-restore-note"]').exists()).toBe(true)
  })

  it("«Ошибка данных»: состояние не получено, но выход остаётся доступен", async () => {
    responses.set("GetAccountArchiveState", failure({ code: "INTERNAL_ERROR" }))

    const wrapper = await render(ArchivedPage)

    expect(stateOf(wrapper)).toBe("data_error")
    expect(wrapper.find('[data-testid="archived-logout"]').exists()).toBe(true)
  })

  it("«Нет доступа»: обычная сессия уходит в кабинет, гость — на вход", async () => {
    responses.set("GetAccountArchiveState", failure({ code: "FORBIDDEN" }))
    await render(ArchivedPage)
    expect(navigations[0]).toBe("/me")

    navigations.length = 0
    responses.set("GetAccountArchiveState", failure({ code: "UNAUTHENTICATED" }))
    await render(ArchivedPage)
    expect(navigations[0]).toBe("/login")
  })

  it("«Заблокирован»: административный архив остаётся здесь и не гоняет редиректами", async () => {
    responses.set("GetAccountArchiveState", failure({ code: "FORBIDDEN", action: "account.restore.self" }))

    const wrapper = await render(ArchivedPage)

    expect(stateOf(wrapper)).toBe("blocked")
    expect(wrapper.find('[data-testid="archived-contact"]').exists()).toBe(true)
    expect(navigations).toHaveLength(0)
  })

  it("восстановление идёт через подтверждение и уводит в кабинет", async () => {
    const wrapper = await render(ArchivedPage)

    await wrapper.get('[data-testid="archived-restore"]').trigger("click")
    expect(wrapper.find('[data-testid="archived-confirm"]').exists()).toBe(true)

    await wrapper.get('[data-testid="confirm-yes"]').trigger("click")
    await flushPromises()

    expect(navigations[0]).toBe("/me")
  })

  it("«Не найдено»: аккаунт уже восстановлен в другой вкладке", async () => {
    responses.set("RestoreAccountSelf", failure({ code: "CONFLICT", entity: "user" }))

    const wrapper = await render(ArchivedPage)
    await wrapper.get('[data-testid="archived-restore"]').trigger("click")
    await wrapper.get('[data-testid="confirm-yes"]').trigger("click")
    await flushPromises()

    expect(wrapper.get('[data-testid="archived-error"]').text()).toBe("account.archived.error.conflict")
    expect(navigations).toHaveLength(0)
  })
})
