// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils"
import { computed, defineComponent, onMounted, onUnmounted, ref, watch } from "vue"
import { Kind, type DocumentNode } from "graphql"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ExportPage from "../app/pages/me/export.vue"

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${Object.values(params).join(",")}` : key

const operationName = (document: DocumentNode): string => {
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) return definition.name?.value ?? ""
  }
  return ""
}

const item = (status: string, overrides: Record<string, unknown> = {}) => ({
  id: `export-${status}`,
  requestedAt: "2026-09-29T09:00:00.000Z",
  status,
  sizeBytes: status === "ready" ? 4096 : null,
  expiresAt: status === "ready" ? "2026-10-06T09:00:00.000Z" : null,
  scope: ["profile", "articles", "media", "review"],
  ...overrides
})

const failure = (extensions: Record<string, unknown>) => ({ data: null, errors: [{ extensions }] })
const listOf = (...exports: unknown[]) => ({ data: { me: { id: "user-1", exports } } })
const responses = new Map<string, unknown>()
const navigations: unknown[] = []
const graphQLRequest = vi.fn(async (document: DocumentNode) => responses.get(operationName(document)))

const render = async () => {
  const host = defineComponent({ components: { Page: ExportPage as never }, template: "<Suspense><Page /></Suspense>" })
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
  responses.set("GetMyAccountExports", listOf())
  responses.set("RequestAccountExport", { data: { requestExport: item("queued") } })
  responses.set("DownloadAccountExport", { data: { exportDownload: "https://files.example/export.zip" } })

  vi.stubGlobal("computed", computed)
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("watch", watch)
  vi.stubGlobal("onMounted", onMounted)
  vi.stubGlobal("onUnmounted", onUnmounted)
  vi.stubGlobal("useI18n", () => ({ t, locale: ref("ru") }))
  vi.stubGlobal("useHead", vi.fn())
  vi.stubGlobal("definePageMeta", vi.fn())
  vi.stubGlobal("useGraphQL", graphQLRequest)
  vi.stubGlobal("navigateTo", async (target: unknown) => navigations.push(target))
  vi.stubGlobal("createError", (input: unknown) => new Error(JSON.stringify(input)))
  vi.stubGlobal("useAsyncData", async (_key: unknown, handler: () => Promise<unknown>) => {
    const data = ref<unknown>(null)
    const error = ref<unknown>(null)
    const status = ref("success")
    const refresh = async () => {
      try {
        data.value = await handler()
        error.value = null
      } catch (thrown) {
        error.value = thrown
      }
    }
    await refresh()
    return { data, error, status, refresh }
  })
})

afterEach(() => vi.unstubAllGlobals())

describe("страница выгрузки: состояния export.md §8", () => {
  it("показывает загрузку, пустую историю и ошибку данных", async () => {
    vi.stubGlobal("useAsyncData", async () => ({
      data: ref(null),
      error: ref(null),
      status: ref("pending"),
      refresh: vi.fn()
    }))
    expect((await render()).get("[data-export-state]").attributes("data-export-state")).toBe("loading")

    vi.stubGlobal("useAsyncData", async (_key: unknown, handler: () => Promise<unknown>) => {
      try {
        return { data: ref(await handler()), error: ref(null), status: ref("success"), refresh: vi.fn() }
      } catch (thrown) {
        return { data: ref(null), error: ref(thrown), status: ref("error"), refresh: vi.fn() }
      }
    })
    expect((await render()).get('[data-testid="export-empty"]').text()).toBe("account.export.empty")

    responses.set("GetMyAccountExports", failure({ code: "INTERNAL_ERROR" }))
    const failed = await render()
    expect(failed.get("[data-export-state]").attributes("data-export-state")).toBe("data_error")
    expect(failed.find('[data-testid="export-retry"]').exists()).toBe(true)
  })

  it.each([
    ["queued", "account.export.status.queued"],
    ["running", "account.export.status.running"],
    ["stuck", "account.export.status.stuck"],
    ["failed", "account.export.status.failed"],
    ["expired", "account.export.status.expired"],
    ["ready", "account.export.status.ready"]
  ])("воспроизводит состояние задания %s", async (status, expected) => {
    responses.set("GetMyAccountExports", listOf(item(status)))
    const wrapper = await render()
    expect(wrapper.get(`[data-export-status="${status}"]`).text()).toContain(expected)
  })

  it("редиректит гостя и ограниченную сессию", async () => {
    responses.set("GetMyAccountExports", failure({ code: "UNAUTHENTICATED" }))
    await render()
    expect(navigations[0]).toMatchObject({ path: "/login", query: { next: "/me/export" } })

    responses.set("GetMyAccountExports", failure({ code: "FORBIDDEN" }))
    await render()
    expect(navigations.at(-1)).toBe("/me/archived")
  })

  it("показывает суточный лимит с оставшимся временем", async () => {
    responses.set("RequestAccountExport", failure({ code: "RATE_LIMITED", retryAfter: 3600 }))
    const wrapper = await render()
    await wrapper.get('[data-testid="export-request"]').trigger("click")
    await flushPromises()
    expect(wrapper.get('[data-testid="export-notice"]').text()).toBe("account.export.rateLimited:60")
  })

  it("скачивает готовый архив только через URL, возвращённый мутацией", async () => {
    responses.set("GetMyAccountExports", listOf(item("ready")))
    const wrapper = await render()
    await wrapper.get('[data-testid="export-download"]').trigger("click")
    await flushPromises()
    expect(graphQLRequest.mock.calls.map(([document]) => operationName(document))).toContain("DownloadAccountExport")
    expect(navigations.at(-1)).toBe("https://files.example/export.zip")
  })
})
