import { computed, ref, type Ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAdminGrants } from "../app/composables/useAdminGrants"

type AsyncDataStatus = "idle" | "pending" | "success" | "error"

let status: Ref<AsyncDataStatus>

beforeEach(() => {
  status = ref<AsyncDataStatus>("idle")
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("computed", computed)
  vi.stubGlobal("useState", (_key: string, init: () => unknown) => ref(init()))
  vi.stubGlobal("useAsyncData", () => ({
    data: ref([]),
    status,
    pending: computed(() => status.value === "pending"),
    error: ref(undefined),
    refresh: vi.fn()
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Список читается только в браузере (`server: false`). На сервере запрос не начат (`idle`), а
// при гидратации Nuxt переводит его в `pending` ещё до первой отрисовки, поэтому обе стороны
// должны считать оба состояния загрузкой — иначе сервер рисует таблицу, а клиент «Загрузка…».
describe("useAdminGrants pending", () => {
  it.each<[AsyncDataStatus, boolean]>([
    ["idle", true],
    ["pending", true],
    ["success", false],
    ["error", false]
  ])("treats %s as loading: %s", (value, expected) => {
    status.value = value

    expect(useAdminGrants().pending.value).toBe(expected)
  })
})
