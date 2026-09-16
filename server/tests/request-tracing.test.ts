import { createHmac } from "node:crypto"
import { createSchema, createYoga } from "graphql-yoga"
import { describe, expect, it } from "vitest"
import { createErrorMasker } from "../src/errors/graphql-error"
import { createAppLogger } from "../src/observability/logger"
import { createRequestTracingPlugin, getRequestId, setRequestUserSnapshot } from "../src/observability/request-tracing"

interface TestContext {
  requestId: string
}

const nuxtRequestId = "11111111-1111-4111-8111-111111111111"
const generatedRequestId = "22222222-2222-4222-8222-222222222222"
const forwardedRequestSecret = "request-forward-secret"

function createTestServer() {
  const lines: string[] = []
  const logger = createAppLogger({
    service: "api",
    environment: "test",
    destination: { write: (line) => lines.push(line) }
  })
  const timestamps = [1_000, 1_025]
  const now = () => timestamps.shift() ?? 1_025

  const yoga = createYoga<TestContext>({
    schema: createSchema({
      typeDefs: /* GraphQL */ `
        type Query {
          requestId: String!
          explode: String
        }
      `,
      resolvers: {
        Query: {
          requestId: (_root, _args, context: TestContext) => context.requestId,
          explode: () => {
            throw new Error("database unavailable")
          }
        }
      }
    }),
    context: () => {
      setRequestUserSnapshot({ id: "user-1", role: "admin" })
      return { requestId: getRequestId() }
    },
    graphqlEndpoint: "/",
    logging: false,
    maskedErrors: { maskError: createErrorMasker({ logger, requestIdFactory: getRequestId }) },
    plugins: [
      createRequestTracingPlugin({
        logger,
        now,
        requestIdFactory: () => generatedRequestId,
        forwardedRequestSecret
      })
    ]
  })

  return { lines, yoga }
}

const execute = (yoga: ReturnType<typeof createTestServer>["yoga"], query: string, requestId = nuxtRequestId) =>
  yoga.fetch("http://localhost/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-graphql-yoga-csrf": "bff",
      "x-request-id": requestId,
      "x-request-id-signature": createHmac("sha256", forwardedRequestSecret).update(requestId).digest("hex")
    },
    body: JSON.stringify({ query })
  })

describe("request tracing", () => {
  it("uses one requestId and writes the authenticated role in http.request", async () => {
    const { lines, yoga } = createTestServer()
    const response = await execute(yoga, "query { requestId }")
    const responseText = await response.text()

    expect(response.headers.get("x-request-id")).toBe(nuxtRequestId)
    expect({ status: response.status, text: responseText }).toEqual({
      status: 200,
      text: JSON.stringify({ data: { requestId: nuxtRequestId } })
    })
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      event: "http.request",
      requestId: nuxtRequestId,
      route: "/",
      status: 200,
      durationMs: 25,
      userId: "user-1",
      role: "admin"
    })
  })

  it("uses the request-scoped ID for a masked technical error", async () => {
    const { lines, yoga } = createTestServer()
    const response = await execute(yoga, "query { explode }")
    const result = (await response.json()) as { errors?: Array<{ extensions?: Record<string, unknown> }> }

    expect(result.errors?.[0]?.extensions).toEqual({ code: "INTERNAL_ERROR", requestId: nuxtRequestId })
    expect(lines.map((line) => JSON.parse(line))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "error.unhandled", requestId: nuxtRequestId }),
        expect.objectContaining({ event: "http.request", requestId: nuxtRequestId, role: "admin" })
      ])
    )
  })

  it.each(["person@example.com", nuxtRequestId])("replaces an untrusted forwarded ID %s", async (untrustedId) => {
    const { lines, yoga } = createTestServer()
    const response = await yoga.fetch("http://localhost/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-graphql-yoga-csrf": "bff",
        "x-request-id": untrustedId
      },
      body: JSON.stringify({ query: "query { requestId }" })
    })

    expect(response.headers.get("x-request-id")).toBe(generatedRequestId)
    await expect(response.json()).resolves.toEqual({ data: { requestId: generatedRequestId } })
    expect(lines.join("")).not.toContain(untrustedId)
  })

  it("isolates IDs across overlapping requests", async () => {
    const { yoga } = createTestServer()
    const secondRequestId = "33333333-3333-4333-8333-333333333333"

    const [first, second] = await Promise.all([
      execute(yoga, "query { requestId }", nuxtRequestId),
      execute(yoga, "query { requestId }", secondRequestId)
    ])

    await expect(first.json()).resolves.toEqual({ data: { requestId: nuxtRequestId } })
    await expect(second.json()).resolves.toEqual({ data: { requestId: secondRequestId } })
  })
})
