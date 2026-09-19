// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { ref, shallowRef, watch } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import GrantsPage from "../app/pages/admin/grants/index.vue"
import SubscriptionsPage from "../app/pages/admin/subscriptions/index.vue"

const messages: Record<string, string> = {
  "admin.grantsTitle": "Ручные выдачи планов",
  "admin.grantsDescription": "Управление ручными выдачами",
  "admin.subscriptionsTitle": "Подписки и планы",
  "admin.subscriptionsDescription": "Управление подписками",
  "admin.firstLaunchSubscriptionsNote": "Платные подписки — отдельный этап",
  "admin.grantPlan": "Выдать план",
  "admin.fieldPlan": "План",
  "admin.fieldStartsAt": "Начало",
  "admin.fieldEndsAt": "Конец",
  "admin.fieldReason": "Причина",
  "admin.userHandleLabel": "Хэндл пользователя",
  "admin.endsAtHint": "обязателен",
  "admin.reasonPlaceholder": "Укажите причину выдачи",
  "common.cancel": "Отмена"
}

const grants = shallowRef([
  {
    id: "grant-custom",
    userId: "user-custom",
    userName: "Тестовый пользователь",
    userHandle: "test-user",
    tier: "standard" as const,
    startsAt: "2026-09-19T00:00:00.000Z",
    endsAt: "2026-10-19T00:00:00.000Z",
    grantedByName: "Аналитик",
    reason: "Проверяемая выдача",
    status: "active" as const,
    revokedAt: null,
    createdAt: "2026-09-18T00:00:00.000Z"
  },
  {
    id: "grant-revoked",
    userId: "user-revoked",
    userName: "Отозванный пользователь",
    userHandle: "revoked-user",
    tier: "pro" as const,
    startsAt: "2026-08-19T00:00:00.000Z",
    endsAt: "2026-10-19T00:00:00.000Z",
    grantedByName: "Администратор",
    reason: "Отозванная выдача",
    status: "revoked" as const,
    revokedAt: "2026-09-18T00:00:00.000Z",
    createdAt: "2026-08-18T00:00:00.000Z"
  }
])

const grantAction = vi.fn()
const revokeAction = vi.fn()
const refresh = vi.fn()

const stubs = {
  Split: { template: '<div><slot name="table" /><slot name="item" /></div>' },
  Table: {
    props: ["dataSource"],
    emits: ["click-row"],
    template:
      '<div><button v-for="row in dataSource" :key="row.id" @click="$emit(\'click-row\', { data: row })">{{ row.userName }} {{ row.status }}</button></div>'
  },
  Button: {
    props: ["disabled"],
    emits: ["click"],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  },
  Modal: { props: ["modelValue"], template: '<div v-if="modelValue"><slot /></div>' },
  Input: {
    props: ["modelValue", "placeholder"],
    emits: ["update:modelValue"],
    template:
      '<input :value="modelValue" :placeholder="placeholder" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  Select: { props: ["modelValue"], template: '<select :value="modelValue" />' },
  Icons: true,
  NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' }
}

beforeEach(() => {
  grantAction.mockReset()
  revokeAction.mockReset()
  refresh.mockReset()
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useI18n", () => ({ t: (key: string) => messages[key] ?? key }))
  vi.stubGlobal("useBreakpoint", () => ({ isSm: ref(false), isMd: ref(true) }))
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("shallowRef", shallowRef)
  vi.stubGlobal("watch", watch)
  vi.stubGlobal("useAdminGrants", () => ({
    grants,
    pending: ref(false),
    failed: ref(false),
    refresh,
    grant: grantAction,
    revoke: revokeAction
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("admin grants pages", () => {
  it("renders server-backed grants without the removed first-launch authorship fixture", () => {
    const wrapper = mount(GrantsPage, { global: { stubs } })

    expect(wrapper.text()).toContain("Тестовый пользователь active")
    expect(wrapper.text()).toContain("Отозванный пользователь revoked")
    expect(wrapper.text()).not.toContain("Базовое авторство первого запуска")
  })

  it("keeps manual submission disabled until an end date is provided", async () => {
    const wrapper = mount(GrantsPage, { global: { stubs } })

    await wrapper.get("button").trigger("click")
    const inputs = wrapper.findAll("input")
    await inputs.find((input) => input.attributes("placeholder") === "user-handle")?.setValue("new-user")
    await inputs.find((input) => input.attributes("placeholder") === "Укажите причину выдачи")?.setValue("Причина")

    const submit = wrapper
      .findAll("button")
      .find((button) => button.text() === "Выдать план" && button.element.disabled)
    expect(submit).toBeDefined()
  })

  it("shows the same server-backed grants and first-launch notice on subscriptions", () => {
    const wrapper = mount(SubscriptionsPage, { global: { stubs } })

    expect(wrapper.text()).toContain("Платные подписки — отдельный этап")
    expect(wrapper.text()).toContain("Тестовый пользователь active")
    expect(wrapper.text()).not.toContain("Базовое авторство первого запуска")
  })
})
