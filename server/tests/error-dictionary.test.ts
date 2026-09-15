import { GraphQLError } from "graphql"
import { describe, expect, it } from "vitest"
import { ERROR_DEFINITIONS, isErrorCode, pickValidExtensions, type ProviderName } from "../src/errors/dictionary"

const expectedFields = {
  UNAUTHENTICATED: ["requestId"],
  FORBIDDEN: ["requestId", "action"],
  NOT_FOUND: ["requestId", "entity"],
  VALIDATION_ERROR: ["requestId", "field", "rule"],
  CONFLICT: ["requestId", "entity", "expected", "actual"],
  RATE_LIMITED: ["requestId", "retryAfter"],
  CONTENT_INVALID: ["requestId", "path", "node"],
  DUPLICATE: ["requestId", "entity", "field"],
  INTERNAL_ERROR: ["requestId"],
  PLAN_LIMIT: ["requestId", "requiredTier", "limit", "current"],
  PROVIDER_UNAVAILABLE: ["requestId", "provider"],
  ARCHIVED: ["requestId", "entity"]
} as const

describe("API error dictionary", () => {
  it("contains exactly the approved error codes and required fields", () => {
    expect(Object.keys(ERROR_DEFINITIONS)).toEqual(Object.keys(expectedFields))

    for (const [code, fields] of Object.entries(expectedFields)) {
      expect(ERROR_DEFINITIONS[code as keyof typeof ERROR_DEFINITIONS].requiredFields).toEqual(fields)
    }
  })

  it("accepts storage as an approved provider", () => {
    const provider: ProviderName = "storage"
    const error = new GraphQLError("ignored", {
      extensions: { code: "PROVIDER_UNAVAILABLE", requestId: "req-1", provider, leaked: "secret" }
    })

    expect(pickValidExtensions(error)).toEqual({
      code: "PROVIDER_UNAVAILABLE",
      requestId: "req-1",
      provider: "storage"
    })
  })

  it.each(["BAD_REQUEST", "FOREIGN_KEY_ERROR", "UNKNOWN", null])("rejects unknown code %s", (code) => {
    expect(isErrorCode(code)).toBe(false)
    expect(pickValidExtensions(new GraphQLError("ignored", { extensions: { code, requestId: "req-1" } }))).toBeNull()
  })

  it("rejects missing, empty and invalid required extension values", () => {
    expect(
      pickValidExtensions(
        new GraphQLError("ignored", { extensions: { code: "NOT_FOUND", requestId: "req-1", entity: "" } })
      )
    ).toBeNull()
    expect(
      pickValidExtensions(
        new GraphQLError("ignored", {
          extensions: { code: "PROVIDER_UNAVAILABLE", requestId: "req-1", provider: "search" }
        })
      )
    ).toBeNull()
  })
})
