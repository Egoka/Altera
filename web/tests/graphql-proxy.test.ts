import { createHmac } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import config from "../nuxt.config"
import { GraphQLProxyError, getGraphQLRouteError, proxyGraphQLRequest } from "../server/utils/graphqlProxy"

const requestId = "11111111-1111-4111-8111-111111111111"
const requestIdForwardSecret = "request-forward-secret"

describe("GraphQL BFF configuration", () => {
  it("keeps the upstream URL in private runtime config", () => {
    expect(config.runtimeConfig?.graphqlApiUrl).toBe("http://127.0.0.1:4000/")
    expect(config.runtimeConfig?.requestIdForwardSecret).toBe("")
    expect(config.runtimeConfig?.public ?? {}).not.toHaveProperty("graphqlApiUrl")
    expect(config.runtimeConfig?.public ?? {}).not.toHaveProperty("requestIdForwardSecret")
  })
})

describe("proxyGraphQLRequest", () => {
  it.each([null, [], {}, { query: "" }, { query: 42 }])("rejects malformed GraphQL body %#", async (body) => {
    const fetchRaw = vi.fn()

    await expect(
      proxyGraphQLRequest({
        graphqlApiUrl: "http://127.0.0.1:4000/",
        body,
        requestId,
        requestIdForwardSecret,
        fetchRaw
      })
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(fetchRaw).not.toHaveBeenCalled()
  })

  it.each(["", "relative/path", "ftp://127.0.0.1/graphql", "https://user:password@example.test/graphql"])(
    "rejects an unsafe upstream URL: %s",
    async (graphqlApiUrl) => {
      await expect(
        proxyGraphQLRequest({
          graphqlApiUrl,
          body: { query: "{ __typename }" },
          requestId,
          requestIdForwardSecret,
          fetchRaw: vi.fn()
        })
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
      requestId,
      requestIdForwardSecret,
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
        "x-request-id": requestId,
        "x-request-id-signature": createHmac("sha256", requestIdForwardSecret).update(requestId).digest("hex"),
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
        requestId,
        requestIdForwardSecret,
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
      requestId,
      requestIdForwardSecret,
      fetchRaw
    })

    await expect(result).rejects.toBeInstanceOf(GraphQLProxyError)
    await expect(result).rejects.toMatchObject({ statusCode: 502, message: "GraphQL upstream is unavailable" })
  })

  it("returns requestId for every technical route failure but not a client error", () => {
    expect(getGraphQLRouteError(new Error("secret failure"), requestId)).toEqual({
      statusCode: 500,
      statusMessage: "Internal server error",
      message: "Internal server error",
      data: { requestId }
    })
    expect(getGraphQLRouteError(new GraphQLProxyError(400, "Invalid GraphQL request body"), requestId)).toEqual({
      statusCode: 400,
      statusMessage: "Invalid GraphQL request body",
      message: "Invalid GraphQL request body"
    })
    expect(
      getGraphQLRouteError({ statusCode: 400, statusMessage: "Bad Request", message: "Malformed JSON" }, requestId)
    ).toEqual({
      statusCode: 400,
      statusMessage: "Bad Request",
      message: "Bad Request"
    })
  })
})
