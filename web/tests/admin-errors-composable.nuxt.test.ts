// @vitest-environment happy-dom

import { ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAdminErrors } from "../app/composables/useAdminErrors"

afterEach(() => vi.unstubAllGlobals())

describe("useAdminErrors", () => {
  beforeEach(() => {
    const state = new Map<string, ReturnType<typeof ref>>()
    vi.stubGlobal("ref", ref)
    vi.stubGlobal("useState", (key: string, init: () => unknown) => {
      if (!state.has(key)) state.set(key, ref(init()))
      return state.get(key)
    })
    vi.stubGlobal("$fetch", vi.fn().mockResolvedValue({ status: "ok" }))
  })

  it("turns a thrown transport failure into the visible error state", async () => {
    vi.stubGlobal("useGraphQL", vi.fn().mockRejectedValue(new Error("connection refused")))
    const errors = useAdminErrors()

    await errors.load({})

    expect(errors.failed.value).toBe(true)
    expect(errors.items.value).toEqual([])
    expect(errors.pending.value).toBe(false)
  })

  it("keeps requestId from a thrown GraphQL transport envelope", async () => {
    vi.stubGlobal(
      "useGraphQL",
      vi.fn().mockRejectedValue({
        data: { errors: [{ extensions: { code: "INTERNAL_ERROR", requestId: "req-transport" } }] }
      })
    )
    const errors = useAdminErrors()

    await errors.load({})

    expect(errors.failed.value).toBe(true)
    expect(errors.errorCode.value).toBe("INTERNAL_ERROR")
    expect(errors.requestId.value).toBe("req-transport")
  })

  it("keeps cached health and marks it stale after a later load failure", async () => {
    const useGraphQL = vi
      .fn()
      .mockResolvedValueOnce({ data: { healthHistory: [{ id: "health-1" }] } })
      .mockRejectedValueOnce(new Error("connection refused"))
    vi.stubGlobal("useGraphQL", useGraphQL)
    const errors = useAdminErrors()

    await errors.loadHealth({ from: "2026-09-27T10:00:00.000Z", to: "2026-09-28T10:00:00.000Z" })
    await errors.load({})

    expect(errors.health.value).toEqual([{ id: "health-1" }])
    expect(errors.healthStale.value).toBe(true)
  })

  it("requests /health before reloading the persisted history", async () => {
    const useGraphQL = vi.fn().mockResolvedValue({ data: { healthHistory: [] } })
    vi.stubGlobal("useGraphQL", useGraphQL)
    const errors = useAdminErrors()

    await errors.checkHealthNow({ from: "2026-09-27T10:00:00.000Z", to: "2026-09-28T10:00:00.000Z" })

    expect(vi.mocked($fetch)).toHaveBeenCalledWith("/health", { headers: { accept: "application/json" } })
    expect(useGraphQL).toHaveBeenCalledOnce()
  })
})
