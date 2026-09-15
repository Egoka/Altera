import { describe, expect, it, vi } from "vitest"
import config from "../nuxt.config"
import { GraphQLProxyError, proxyGraphQLRequest } from "../server/utils/graphqlProxy"

describe("GraphQL BFF configuration", () => {
  it("keeps the upstream URL in private runtime config", () => {
    expect(config.runtimeConfig?.graphqlApiUrl).toBe("http://127.0.0.1:4000/")
    expect(config.runtimeConfig?.public ?? {}).not.toHaveProperty("graphqlApiUrl")
  })
})

describe("proxyGraphQLRequest", () => {
  it.each([null, [], {}, { query: "" }, { query: 42 }])("rejects malformed GraphQL body %#", async (body) => {
    const fetchRaw = vi.fn()

    await expect(
      proxyGraphQLRequest({ graphqlApiUrl: "http://127.0.0.1:4000/", body, fetchRaw })
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(fetchRaw).not.toHaveBeenCalled()
  })

  it.each(["", "relative/path", "ftp://127.0.0.1/graphql", "https://user:password@example.test/graphql"])(
    "rejects an unsafe upstream URL: %s",
    async (graphqlApiUrl) => {
      await expect(
        proxyGraphQLRequest({ graphqlApiUrl, body: { query: "{ __typename }" }, fetchRaw: vi.fn() })
      ).rejects.toMatchObject({ statusCode: 500 })
    }
  )

  it("sends only allowlisted headers and adds Yoga CSRF protection", async () => {
    const fetchRaw = vi.fn(async () => ({
      status: 200,
      headers: new Headers({ "content-type": "application/json", "set-cookie": "session=upstream" }),
      _data: { data: { __typename: "Query" } }
    }))

    await proxyGraphQLRequest({
      graphqlApiUrl: "http://127.0.0.1:4000/",
      body: { query: "{ __typename }" },
      authorization: "Bearer test-token",
      fetchRaw
    })

    expect(fetchRaw).toHaveBeenCalledOnce()
    expect(fetchRaw).toHaveBeenCalledWith("http://127.0.0.1:4000/", {
      method: "POST",
      body: { query: "{ __typename }" },
      headers: {
        accept: "application/graphql-response+json, application/json",
        authorization: "Bearer test-token",
        "content-type": "application/json",
        "x-graphql-yoga-csrf": "bff"
      },
      ignoreResponseError: true
    })
  })

  it("preserves upstream status and the complete GraphQL envelope", async () => {
    const envelope = {
      data: { article: null },
      errors: [{ message: "Not found" }]
    }
    const fetchRaw = vi.fn(async () => ({
      status: 404,
      headers: new Headers({ "content-type": "application/graphql-response+json; charset=utf-8" }),
      _data: envelope
    }))

    await expect(
      proxyGraphQLRequest({
        graphqlApiUrl: "https://api.example.test/graphql",
        body: { query: "query Article { article { id } }" },
        fetchRaw
      })
    ).resolves.toEqual({
      status: 404,
      contentType: "application/graphql-response+json; charset=utf-8",
      body: envelope
    })
  })

  it("returns a safe 502 error when the upstream is unavailable", async () => {
    const fetchRaw = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED http://private-api.example.test/graphql")
    })

    const result = proxyGraphQLRequest({
      graphqlApiUrl: "http://private-api.example.test/graphql",
      body: { query: "{ __typename }" },
      fetchRaw
    })

    await expect(result).rejects.toBeInstanceOf(GraphQLProxyError)
    await expect(result).rejects.toMatchObject({ statusCode: 502, message: "GraphQL upstream is unavailable" })
  })
})
