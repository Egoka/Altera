// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { computed, defineComponent, ref, watch } from "vue"
import { Kind, type DocumentNode } from "graphql"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ProfileSettingsPage from "../app/pages/me/settings.vue"

const t = (key: string) => key
const operationName = (document: DocumentNode): string => {
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) return definition.name?.value ?? ""
  }
  return ""
}
const profile = (overrides: Record<string, unknown> = {}) => ({
  id: "user-1",
  role: "reader",
  archivedAt: null,
  name: "Вера",
  pendingName: null,
  nameCheckStatus: "ok",
  nameCheckReason: null,
  handle: "vera",
  handleConfirmed: true,
  handleChangedAt: null,
  bio: "Пишу о культуре",
  locale: "ru",
  socialLinks: { site: "https://example.test/" },
  avatar: null,
  avatarCheckStatus: "ok",
  avatarCheckReason: null,
  ...overrides
})

const responses = new Map<string, unknown>()
const graphQLRequest = vi.fn(async (document: DocumentNode) => responses.get(operationName(document)))

const render = async () => {
  const host = defineComponent({ components: { Page: ProfileSettingsPage }, template: "<Suspense><Page /></Suspense>" })
  const wrapper = mount(host, {
    global: { stubs: { NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' } } }
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  responses.clear()
  graphQLRequest.mockClear()
  responses.set("GetMyProfile", { data: { me: profile() } })
  responses.set("CheckHandle", { data: { checkHandle: { handle: "vera-new", available: true } } })
  responses.set("UpdateProfile", { data: { updateProfile: profile({ handle: "vera-new" }) } })
  vi.stubGlobal("computed", computed)
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("watch", watch)
  vi.stubGlobal("useI18n", () => ({ t, locale: ref("ru") }))
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useGraphQL", graphQLRequest)
  vi.stubGlobal("navigateTo", vi.fn())
  vi.stubGlobal("useAsyncData", async (_key: string, handler: () => Promise<unknown>) => {
    const data = ref(await handler())
    return { data, error: ref(null), status: ref("success"), refresh: vi.fn() }
  })
})

afterEach(() => vi.unstubAllGlobals())

describe("T-031 profile settings", () => {
  it("shows the public identity and publishing readiness", async () => {
    const wrapper = await render()

    expect(wrapper.get("[data-profile-state]").attributes("data-profile-state")).toBe("ready")
    expect(wrapper.get('[data-testid="profile-public-url"]').text()).toContain("@vera")
    expect(wrapper.get('[data-testid="profile-publish-ready"]').attributes("data-ready")).toBe("true")
  })

  it("keeps the old public name visible while a new one awaits review", async () => {
    responses.set("GetMyProfile", {
      data: { me: profile({ pendingName: "Новое имя", nameCheckStatus: "pending" }) }
    })

    const wrapper = await render()

    expect(wrapper.get('[data-testid="profile-name-status"]').text()).toBe("account.profile.status.namePending")
    expect((wrapper.get('[data-testid="profile-name"]').element as HTMLInputElement).value).toBe("Новое имя")
  })

  it("checks a changed handle and saves all editable fields", async () => {
    const wrapper = await render()
    await wrapper.get('[data-testid="profile-handle"]').setValue("vera-new")
    await wrapper.get('[data-testid="profile-handle"]').trigger("blur")
    await flushPromises()
    expect(wrapper.get('[data-testid="profile-handle-status"]').text()).toBe("account.profile.handleAvailable")

    await wrapper.get('[data-testid="profile-form"]').trigger("submit")
    await flushPromises()
    expect(graphQLRequest).toHaveBeenCalledWith(
      expect.objectContaining({ definitions: expect.any(Array) }),
      expect.objectContaining({ input: expect.objectContaining({ handle: "vera-new", name: "Вера" }) })
    )
    expect(wrapper.get('[data-testid="profile-saved"]').text()).toBe("account.profile.saved")
  })

  it("shows a public rejection reason", async () => {
    responses.set("GetMyProfile", {
      data: { me: profile({ nameCheckStatus: "rejected", nameCheckReason: "Используйте настоящее имя" }) }
    })
    const wrapper = await render()

    expect(wrapper.get('[data-testid="profile-name-status"]').text()).toContain("Используйте настоящее имя")
  })
})
