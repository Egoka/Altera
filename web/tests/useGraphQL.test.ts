import { print } from "graphql"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FeedCardFragmentDoc } from "../app/graphql/generated/graphql"
import { useGraphQL } from "../app/composables/useGraphQL"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useGraphQL", () => {
  it("posts a generated typed document to the relative BFF endpoint", async () => {
    const envelope = { data: { article: null }, errors: [{ message: "Not found" }] }
    const requestFetch = vi.fn().mockResolvedValue(envelope)
    vi.stubGlobal("useRequestFetch", () => requestFetch)

    const result = await useGraphQL(FeedCardFragmentDoc, { articleId: "article-1" })

    expect(requestFetch).toHaveBeenCalledWith("/api/graphql", {
      method: "POST",
      body: {
        query: print(FeedCardFragmentDoc),
        variables: { articleId: "article-1" }
      }
    })
    expect(result).toEqual(envelope)
  })
})
