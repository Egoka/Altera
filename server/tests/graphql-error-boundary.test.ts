import { GraphQLError } from "graphql"
import { createSchema, createYoga } from "graphql-yoga"
import { beforeEach, describe, expect, it } from "vitest"
import { createApiError, createErrorMasker } from "../src/errors/graphql-error"
import { createAppLogger } from "../src/observability/logger"

interface GraphQLResponse {
  data?: Record<string, unknown>
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>
}

const lines: string[] = []
const logger = createAppLogger({
  service: "api",
  environment: "test",
  destination: { write: (line) => lines.push(line) }
})

const yoga = createYoga({
  schema: createSchema({
    typeDefs: /* GraphQL */ `
      type Query {
        unknown: String
        known: String
        malformed: String
        forged: String
        nested: String
        caused: String
        cyclic: String
        mutated: String
      }
    `,
    resolvers: {
      Query: {
        unknown: () => {
          throw new Error("boom person@example.com")
        },
        known: () => {
          throw createApiError("NOT_FOUND", { requestId: "known-request", entity: "article" })
        },
        malformed: () => {
          throw new GraphQLError("leaked person@example.com", {
            extensions: { code: "NOT_FOUND", requestId: "malformed-request", stack: "leaked" }
          })
        },
        forged: () => {
          throw new GraphQLError("forged", {
            extensions: { code: "NOT_FOUND", requestId: "forged-request", entity: "article" }
          })
        },
        nested: () => {
          const known = createApiError("NOT_FOUND", { requestId: "nested-request", entity: "article" })
          const middle = new GraphQLError("middle", { originalError: known })
          throw new GraphQLError("outer", { originalError: middle })
        },
        caused: () => {
          const known = createApiError("NOT_FOUND", { requestId: "cause-request", entity: "article" })
          throw new Error("outer", { cause: known })
        },
        cyclic: () => {
          const first = new Error("first")
          const second = new Error("second", { cause: first })
          first.cause = second
          throw first
        },
        mutated: () => {
          const known = createApiError("NOT_FOUND", { requestId: "mutation-request", entity: "article" })
          known.extensions.code = "FORBIDDEN"
          known.extensions.entity = "person@example.com"
          known.extensions.action = "leaked"
          throw known
        }
      }
    }
  }),
  logging: false,
  maskedErrors: {
    maskError: createErrorMasker({ logger, requestIdFactory: () => "fallback-request" })
  }
})

type QueryField = "unknown" | "known" | "malformed" | "forged" | "nested" | "caused" | "cyclic" | "mutated"

async function execute(field: QueryField): Promise<GraphQLResponse> {
  const response = await yoga.fetch("http://localhost/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: `query { ${field} }` })
  })
  return (await response.json()) as GraphQLResponse
}

describe("GraphQL Yoga error boundary", () => {
  beforeEach(() => {
    lines.length = 0
  })

  it("masks an unknown resolver error and correlates it with one safe log", async () => {
    const result = await execute("unknown")
    const serialized = JSON.stringify(result)

    expect(result.errors).toEqual([
      {
        message: "Internal server error",
        extensions: { code: "INTERNAL_ERROR", requestId: "fallback-request" }
      }
    ])
    expect(serialized).not.toContain("boom")
    expect(serialized).not.toContain("person@example.com")
    expect(serialized).not.toContain("stack")
    expect(serialized).not.toContain("cause")
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      event: "error.unhandled",
      requestId: "fallback-request",
      error: { stack: expect.stringContaining("Error: boom [REDACTED]") }
    })
    expect(lines[0]).not.toContain("person@example.com")
  })

  it("rebuilds a known error from its fixed definition and allowlisted extensions", async () => {
    const result = await execute("known")

    expect(lines).toEqual([])
    expect(result.errors).toEqual([
      {
        message: "Entity not found",
        extensions: { code: "NOT_FOUND", requestId: "known-request", entity: "article" }
      }
    ])
  })

  it("masks a dictionary code that is missing a required field", async () => {
    const result = await execute("malformed")

    expect(result.errors).toEqual([
      {
        message: "Internal server error",
        extensions: { code: "INTERNAL_ERROR", requestId: "fallback-request" }
      }
    ])
    expect(JSON.stringify(result)).not.toContain("person@example.com")
    expect(JSON.stringify(result)).not.toContain("stack")
    expect(lines).toHaveLength(1)
  })

  it("does not trust complete extensions on an error not created by the factory", async () => {
    const result = await execute("forged")

    expect(result.errors).toEqual([
      {
        message: "Internal server error",
        extensions: { code: "INTERNAL_ERROR", requestId: "fallback-request" }
      }
    ])
    expect(lines).toHaveLength(1)
  })

  it.each([
    ["nested", "nested-request"],
    ["caused", "cause-request"]
  ] as const)("finds a factory error through the %s wrapper chain", async (field, requestId) => {
    const result = await execute(field)

    expect(result.errors).toEqual([
      {
        message: "Entity not found",
        extensions: { code: "NOT_FOUND", requestId, entity: "article" }
      }
    ])
    expect(lines).toEqual([])
  })

  it("terminates cyclic cause traversal and treats it as unknown", async () => {
    const result = await execute("cyclic")

    expect(result.errors?.[0]?.extensions).toEqual({ code: "INTERNAL_ERROR", requestId: "fallback-request" })
    expect(lines).toHaveLength(1)
  })

  it("uses the immutable factory snapshot after public extensions are mutated", async () => {
    const result = await execute("mutated")

    expect(result.errors).toEqual([
      {
        message: "Entity not found",
        extensions: { code: "NOT_FOUND", requestId: "mutation-request", entity: "article" }
      }
    ])
    expect(JSON.stringify(result)).not.toContain("person@example.com")
    expect(lines).toEqual([])
  })
})
