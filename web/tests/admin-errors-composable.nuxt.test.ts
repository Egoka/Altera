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
})
