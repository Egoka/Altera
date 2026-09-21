// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { computed, defineComponent, ref, watch } from "vue"
import { Kind, type DocumentNode } from "graphql"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import EmailChangePage from "../app/pages/me/email.vue"
import MaskedValue from "../app/components/me/MaskedValue.vue"
import CodeInput from "../app/components/me/CodeInput.vue"

// Строки состояний `docs/spec/30-account/reader/email-change.md` §8 и развилки
// `docs/spec/10-flows/email-change-and-recovery.md` §4–5.

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${Object.values(params).join(",")}` : key

const operationName = (document: DocumentNode): string => {
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) return definition.name?.value ?? ""
  }
  return ""
}

const state = (pending: { newEmailMasked: string; expiresAt: string; attemptsLeft: number } | null) => ({
  currentEmailMasked: "r•••@example.test",
  pending
})

const openPending = (minutesLeft = 15) => ({
  newEmailMasked: "n•••@example.test",
  expiresAt: new Date(Date.now() + minutesLeft * 60_000).toISOString(),
  attemptsLeft: 10
})

const failure = (extensions: Record<string, unknown>) => ({ data: null, errors: [{ extensions }] })

const responses = new Map<string, unknown>()
const navigations: unknown[] = []
const graphQLRequest = vi.fn(async (document: DocumentNode) => {
  const name = operationName(document)
  const response = responses.get(name)
  if (typeof response === "function") return (response as () => unknown)()
  return response ?? { data: null, errors: [{ extensions: { code: "INTERNAL_ERROR" } }] }
})

const render = async (component: unknown) => {
  const host = defineComponent({
    components: { Page: component as never },
    template: "<Suspense><Page /></Suspense>"
  })
  const wrapper = mount(host, {
    global: { stubs: { NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' } } }
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  responses.clear()
  navigations.length = 0
  graphQLRequest.mockClear()
  responses.set("GetMyEmailChange", {
    data: { me: { id: "user-1", email: "reader@example.test", emailChange: state(null) } }
  })

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

describe("страница смены почты: строки состояний §8", () => {
  it("«Загрузка»: пока состояние не получено, показывается скелет", async () => {
    vi.stubGlobal("useAsyncData", async () => ({
      data: ref(null),
      error: ref(null),
      status: ref("pending"),
      refresh: vi.fn()
    }))

    const wrapper = await render(EmailChangePage)

    expect(wrapper.get("[data-email-change-state]").attributes("data-email-change-state")).toBe("loading")
    expect(wrapper.find('[data-testid="email-change-skeleton"]').exists()).toBe(true)
  })

  it("«Пусто»: без открытого запроса показывается форма адреса и маскированный текущий", async () => {
    const wrapper = await render(EmailChangePage)

    expect(wrapper.get("[data-email-change-state]").attributes("data-email-change-state")).toBe("ready")
    expect(wrapper.get("[data-email-change-variant]").attributes("data-email-change-variant")).toBe("address")
    expect(wrapper.get('[data-testid="email-change-current"]').text()).toContain("r•••@example.test")
    expect(wrapper.text()).not.toContain("reader@example.test")
  })

  it("«Ошибка данных»: отказ чтения показывает сообщение и кнопку повтора", async () => {
    responses.set("GetMyEmailChange", failure({ code: "INTERNAL_ERROR", requestId: "req-1" }))

    const wrapper = await render(EmailChangePage)

    expect(wrapper.get("[data-email-change-state]").attributes("data-email-change-state")).toBe("data_error")
    expect(wrapper.find('[data-testid="email-change-retry"]').exists()).toBe(true)
  })

  it("«Нет доступа»: без сессии страница уводит на вход с путём возврата", async () => {
    responses.set("GetMyEmailChange", failure({ code: "UNAUTHENTICATED" }))

    await render(EmailChangePage)

    expect(navigations[0]).toMatchObject({ path: "/login", query: { next: "/me/email" } })
  })

  it("«Заблокирован»: ограниченная сессия уводит на экран состояния аккаунта", async () => {
    responses.set("GetMyEmailChange", failure({ code: "FORBIDDEN", action: "email.change" }))

    await render(EmailChangePage)

    expect(navigations[0]).toBe("/me/archived")
  })

  it("«Не найдено»: истёкший код остаётся в зоне 4 с предложением отправить ещё раз", async () => {
    responses.set("GetMyEmailChange", {
      data: { me: { id: "user-1", email: "reader@example.test", emailChange: state(openPending(-1)) } }
    })

    const wrapper = await render(EmailChangePage)

    expect(wrapper.get("[data-email-change-variant]").attributes("data-email-change-variant")).toBe("code")
    expect(wrapper.get('[data-testid="email-change-expired"]').text()).toBe("account.email.expired")
    expect(wrapper.get('[data-testid="email-change-confirm"]').attributes("disabled")).toBeDefined()
    expect(wrapper.find('[data-testid="email-change-resend"]').exists()).toBe(true)
  })

  it("«Ограничение»: лимит запросов кода показывает время следующей попытки", async () => {
    responses.set("RequestEmailChange", failure({ code: "RATE_LIMITED", retryAfter: 3600 }))

    const wrapper = await render(EmailChangePage)
    await wrapper.get('[data-testid="email-change-address"]').setValue("new@example.test")
    await wrapper.get('[data-testid="email-change-send"]').trigger("submit")
    await flushPromises()

    expect(wrapper.get('[data-testid="email-change-error"]').text()).toBe("account.email.error.rateLimited:60")
  })

  it("зона 5 ведёт в редакцию с темой восстановления доступа", async () => {
    const wrapper = await render(EmailChangePage)

    expect(wrapper.get('[data-testid="email-change-contact"]').attributes("href")).toBe(
      "/contact?topic=access_recovery"
    )
  })
})

describe("страница смены почты: развилки flow #13 §4", () => {
  const requestCode = async (wrapper: Awaited<ReturnType<typeof render>>, address = "new@example.test") => {
    await wrapper.get('[data-testid="email-change-address"]').setValue(address)
    await wrapper.get('[data-testid="email-change-send"]').trigger("submit")
    await flushPromises()
  }

  const confirmCode = async (wrapper: Awaited<ReturnType<typeof render>>, code = "123456") => {
    await wrapper.get('[data-testid="email-change-code"]').setValue(code)
    await wrapper.get('[data-testid="email-change-confirm"]').trigger("submit")
    await flushPromises()
  }

  it("отправленный код переводит окно на ввод кода без перезагрузки страницы", async () => {
    responses.set("RequestEmailChange", { data: { requestEmailChange: state(openPending()) } })

    const wrapper = await render(EmailChangePage)
    await requestCode(wrapper)

    expect(wrapper.get("[data-email-change-variant]").attributes("data-email-change-variant")).toBe("code")
    expect(wrapper.get('[data-testid="email-change-sent-to"]').text()).toContain("n•••@example.test")
    expect(wrapper.get('[data-testid="email-change-attempts"]').text()).toBe("account.email.attemptsLeft:10")
  })

  it("адрес, равный текущему, и неверный формат дают свои строки", async () => {
    responses.set(
      "RequestEmailChange",
      failure({ code: "VALIDATION_ERROR", field: "newEmail", rule: "different from current" })
    )

    const wrapper = await render(EmailChangePage)
    await requestCode(wrapper, "reader@example.test")
    expect(wrapper.get('[data-testid="email-change-error"]').text()).toBe("account.email.error.sameEmail")

    responses.set("RequestEmailChange", failure({ code: "VALIDATION_ERROR", field: "newEmail", rule: "email format" }))
    await requestCode(wrapper, "broken")
    expect(wrapper.get('[data-testid="email-change-error"]').text()).toBe("account.email.error.invalidEmail")
  })

  it("открытый запрос на другой адрес сообщает о конфликте", async () => {
    responses.set(
      "RequestEmailChange",
      failure({ code: "CONFLICT", entity: "emailChange", expected: "no open request", actual: "open request" })
    )

    const wrapper = await render(EmailChangePage)
    await requestCode(wrapper, "third@example.test")

    expect(wrapper.get('[data-testid="email-change-error"]').text()).toBe("account.email.error.openRequest")
  })

  it("неверный код остаётся на шаге кода и называет причину", async () => {
    responses.set("RequestEmailChange", { data: { requestEmailChange: state(openPending()) } })
    responses.set("ConfirmEmailChange", failure({ code: "VALIDATION_ERROR", field: "code", rule: "confirmation code" }))

    const wrapper = await render(EmailChangePage)
    await requestCode(wrapper)
    await confirmCode(wrapper, "000000")

    expect(wrapper.get("[data-email-change-variant]").attributes("data-email-change-variant")).toBe("code")
    expect(wrapper.get('[data-testid="email-change-error"]').text()).toBe("account.email.error.wrongCode")
  })

  it("занятый адрес сообщается на шаге кода и возвращает форму адреса", async () => {
    responses.set("RequestEmailChange", { data: { requestEmailChange: state(openPending()) } })
    responses.set("ConfirmEmailChange", failure({ code: "CONFLICT", entity: "user" }))

    const wrapper = await render(EmailChangePage)
    await requestCode(wrapper)
    await confirmCode(wrapper)

    expect(wrapper.get('[data-testid="email-change-error"]').text()).toBe("account.email.error.addressTaken")
    // Сервер закрыл запрос: свежее чтение возвращает пустую форму (§8).
    expect(wrapper.get("[data-email-change-variant]").attributes("data-email-change-variant")).toBe("address")
  })

  it("успешная смена обновляет зону 2, закрывает форму и говорит о сохранённых сессиях", async () => {
    responses.set("RequestEmailChange", { data: { requestEmailChange: state(openPending()) } })
    responses.set("ConfirmEmailChange", {
      data: { confirmEmailChange: { email: "n•••@example.test", changedAt: "2026-09-21T10:00:00.000Z" } }
    })

    const wrapper = await render(EmailChangePage)
    await requestCode(wrapper)

    responses.set("GetMyEmailChange", {
      data: {
        me: {
          id: "user-1",
          email: "new@example.test",
          emailChange: { currentEmailMasked: "n•••@example.test", pending: null }
        }
      }
    })
    await confirmCode(wrapper)

    expect(wrapper.get('[data-testid="email-change-changed"]').text()).toBe("account.email.changed")
    expect(wrapper.get("[data-email-change-variant]").attributes("data-email-change-variant")).toBe("address")
    expect(wrapper.get('[data-testid="email-change-current"]').text()).toContain("n•••@example.test")
  })

  it("отмена закрывает открытый запрос", async () => {
    responses.set("RequestEmailChange", { data: { requestEmailChange: state(openPending()) } })
    responses.set("CancelEmailChange", { data: { cancelEmailChange: state(null) } })

    const wrapper = await render(EmailChangePage)
    await requestCode(wrapper)
    await wrapper.get('[data-testid="email-change-cancel"]').trigger("click")
    await flushPromises()

    expect(wrapper.get("[data-email-change-variant]").attributes("data-email-change-variant")).toBe("address")
  })
})

describe("компоненты зоны 2 и зоны 4", () => {
  beforeEach(() => {
    vi.stubGlobal("useI18n", () => ({ t, locale: ref("ru") }))
  })

  it("MaskedValue открывает полный адрес только по нажатию", async () => {
    const wrapper = mount(MaskedValue, { props: { masked: "r•••@example.test", value: "reader@example.test" } })

    expect(wrapper.get('[data-testid="masked-value-text"]').text()).toBe("r•••@example.test")
    await wrapper.get('[data-testid="masked-value-toggle"]').trigger("click")
    expect(wrapper.get('[data-testid="masked-value-text"]').text()).toBe("reader@example.test")
  })

  it("MaskedValue без полного значения не предлагает «показать»", () => {
    const wrapper = mount(MaskedValue, { props: { masked: "r•••@example.test" } })

    expect(wrapper.find('[data-testid="masked-value-toggle"]').exists()).toBe(false)
  })

  it("CodeInput оставляет только шесть цифр и подсказывает числовую клавиатуру", async () => {
    const wrapper = mount(CodeInput, { props: { id: "code", modelValue: "" } })
    const input = wrapper.get("input")

    expect(input.attributes("inputmode")).toBe("numeric")
    expect(input.attributes("autocomplete")).toBe("one-time-code")

    await input.setValue("12 34-56789")

    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["123456"])
  })
})
