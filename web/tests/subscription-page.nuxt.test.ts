// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { computed, defineComponent, ref, watch } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import SubscriptionPage from "../app/pages/me/subscription.vue"
import {
  resolveSubscriptionOutcome,
  subscriptionView,
  type SubscriptionAccount
} from "../app/utils/accountSubscription"

// T-036: строки состояний `docs/spec/30-account/reader/subscription.md` §8 на первом запуске
// (журнал §24.1): план из выдач, без платежей и платёжных действий.

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${Object.values(params).join(",")}` : key

type Subscription = NonNullable<SubscriptionAccount["subscription"]>

const account = (subscription: Partial<Subscription> | null = {}, role = "reader"): SubscriptionAccount => ({
  id: "user-1",
  role,
  subscription:
    subscription === null
      ? null
      : { state: "free", tier: "free", until: null, endedAt: null, queue: [], ...subscription }
})

const envelope = (me: SubscriptionAccount | null, extensions?: Record<string, unknown>) => ({
  data: { me },
  ...(extensions ? { errors: [{ extensions }] } : {})
})

let response: unknown
const navigations: unknown[] = []
const clearSession = vi.fn()

const stubs = { NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' } }

const render = async () => {
  const host = defineComponent({
    components: { Page: SubscriptionPage as never },
    template: "<Suspense><Page /></Suspense>"
  })
  const wrapper = mount(host, { global: { stubs } })
  await flushPromises()
  return wrapper
}

const stateOf = (wrapper: Awaited<ReturnType<typeof render>>) =>
  wrapper.get("[data-subscription-state]").attributes("data-subscription-state")

beforeEach(() => {
  response = envelope(account())
  navigations.length = 0
  clearSession.mockClear()

  vi.stubGlobal("computed", computed)
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("watch", watch)
  vi.stubGlobal("useI18n", () => ({ t, locale: ref("ru") }))
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useAuthSession", () => ({ clear: clearSession }))
  vi.stubGlobal("useGraphQL", async () => {
    if (response instanceof Error) throw response
    return response
  })
  vi.stubGlobal("navigateTo", async (target: unknown) => {
    navigations.push(target)
  })
  // Клиентский переход: загрузка ленивая, данные приходят после первого рендера.
  vi.stubGlobal("useAsyncData", (_key: unknown, handler: () => Promise<unknown>) => {
    const data = ref<unknown>(null)
    const status = ref("pending")
    const refresh = async () => {
      status.value = "pending"
      data.value = await handler()
      status.value = "success"
    }
    void refresh()
    return { data, status, refresh }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("страница подписки: строки состояний §8 на первом запуске", () => {
  it("«Загрузка»: пока план не получен, показывается скелет", async () => {
    vi.stubGlobal("useAsyncData", () => ({ data: ref(null), status: ref("pending"), refresh: vi.fn() }))

    const wrapper = await render()

    expect(stateOf(wrapper)).toBe("loading")
    expect(wrapper.find('[data-testid="subscription-skeleton"]').exists()).toBe(true)
  })

  it("базовый план без оплаты: «платные планы появятся позже», платежей нет, действий оплаты нет", async () => {
    response = envelope(account({ state: "base", tier: "standard" }))

    const wrapper = await render()

    expect(stateOf(wrapper)).toBe("ready")
    expect(wrapper.get('[data-testid="subscription-plan-headline"]').text()).toBe("account.subscription.plan.base")
    expect(wrapper.get('[data-testid="subscription-plan-later"]').text()).toBe("account.subscription.plan.later")
    expect(wrapper.get('[data-testid="subscription-payments"]').text()).toContain("account.subscription.payments.empty")
    expect(wrapper.find('[data-testid="subscription-queue"]').exists()).toBe(false)
    expect(wrapper.find('a[href^="/me/subscription/checkout"]').exists()).toBe(false)
    expect(wrapper.findAll("button")).toHaveLength(0)
  })

  it("аккаунт без выдач тоже видит базовый план первого запуска", async () => {
    const wrapper = await render()

    expect(wrapper.get('[data-testid="subscription-plan"]').attributes("data-plan-view")).toBe("base")
  })

  it("действующая выдача показывает срок, источник и очередь периодов", async () => {
    response = envelope(
      account({
        state: "active",
        tier: "pro",
        until: "2026-10-01T00:00:00.000Z",
        queue: [{ tier: "standard", startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z" }]
      })
    )

    const wrapper = await render()

    expect(wrapper.get('[data-testid="subscription-plan-headline"]').text()).toMatch(
      /^account\.subscription\.plan\.activeUntil:account\.dashboard\.plan\.tier\.pro,/
    )
    expect(wrapper.find('[data-testid="subscription-plan-source"]').exists()).toBe(true)
    expect(wrapper.get("#queue").findAll("li")).toHaveLength(1)
  })

  it("«Ограничение плана»: истёкшая выдача предлагает продлить через планы, а не checkout", async () => {
    response = envelope(account({ state: "expired", endedAt: "2026-09-19T00:00:00.000Z" }))

    const wrapper = await render()

    expect(stateOf(wrapper)).toBe("plan_limit")
    expect(wrapper.find('[data-testid="subscription-plan-readonly"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="subscription-plan-renew"]').attributes("href")).toBe("/pricing")
    expect(wrapper.find('[data-testid="subscription-plan-later"]').exists()).toBe(false)
  })

  it("служебная запись видит пояснение §8.17 и ссылку в «Подписки» админки", async () => {
    response = envelope(account(null, "admin"))

    const wrapper = await render()

    expect(stateOf(wrapper)).toBe("service")
    expect(wrapper.get('[data-testid="subscription-service-admin"]').attributes("href")).toBe("/admin/subscriptions")
    expect(wrapper.find('[data-testid="subscription-payments"]').exists()).toBe(false)
  })

  it("«Ошибка данных»: код запроса и повтор", async () => {
    response = envelope(null, { code: "INTERNAL_ERROR", requestId: "req-t036" })

    const wrapper = await render()

    expect(stateOf(wrapper)).toBe("data_error")
    expect(wrapper.get('[data-testid="subscription-error"]').text()).toContain("req-t036")

    response = envelope(account({ state: "base" }))
    await wrapper.get('[data-testid="subscription-error"] button').trigger("click")
    await flushPromises()
    expect(stateOf(wrapper)).toBe("ready")
  })

  it("«Заблокирован»: ограниченная сессия уходит на `/me/archived`", async () => {
    // Так отвечает API: `me` есть, отказано только полю `subscription`.
    response = envelope(account(null), { code: "FORBIDDEN" })

    await render()

    expect(navigations).toEqual(["/me/archived"])
  })

  it("«Нет доступа»: непризнанная сессия стирается, вход с путём возврата", async () => {
    response = envelope(null, { code: "UNAUTHENTICATED" })

    await render()

    expect(clearSession).toHaveBeenCalled()
    expect(navigations).toEqual([{ path: "/login", query: { next: "/me/subscription" } }])
  })
})

describe("resolveSubscriptionOutcome", () => {
  it("treats a network failure and a personal account without a plan as a data error", () => {
    expect(resolveSubscriptionOutcome({ data: null })).toEqual({ kind: "error", requestId: null })
    expect(resolveSubscriptionOutcome(envelope(account(null)))).toEqual({ kind: "error", requestId: null })
  })

  it("keeps a service record without a plan readable", () => {
    const staff = account(null, "admin")
    expect(resolveSubscriptionOutcome(envelope(staff))).toEqual({ kind: "ready", account: staff })
    expect(subscriptionView(staff)).toBe("service")
  })

  it("maps the dashboard plan states onto the launch views", () => {
    expect(subscriptionView(account({ state: "free" }))).toBe("base")
    expect(subscriptionView(account({ state: "base" }))).toBe("base")
    expect(subscriptionView(account({ state: "active" }))).toBe("active")
    expect(subscriptionView(account({ state: "expired" }))).toBe("expired")
  })
})
