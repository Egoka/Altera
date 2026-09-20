import { describe, expect, it } from "vitest"
import {
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  extractSessionCookie,
  isSameOriginMutation,
  readOperation,
  withRefreshTokenVariable
} from "../server/utils/sessionCookie"

const refreshMutation =
  'mutation RefreshSession($refreshToken: String! = "") { refreshSession(refreshToken: $refreshToken) { accessToken refreshToken } }'
const logoutMutation = "mutation Logout($refreshToken: String) { logout(refreshToken: $refreshToken) }"

describe("readOperation", () => {
  it("reports the mutation fields of the selected operation", () => {
    expect(readOperation({ query: refreshMutation })).toEqual({ isMutation: true, fields: ["refreshSession"] })
  })

  it("picks the operation named by the request", () => {
    const query = `${refreshMutation}\n${logoutMutation}`

    expect(readOperation({ query, operationName: "Logout" })).toEqual({ isMutation: true, fields: ["logout"] })
    expect(readOperation({ query })).toEqual({ isMutation: false, fields: [] })
  })

  it.each([
    ["a query", { query: "{ __typename }" }],
    ["a malformed document", { query: "mutation {" }],
    ["a body without a query", { variables: {} }],
    ["a non-object body", null]
  ])("returns no mutation fields for %s", (_name, body) => {
    expect(readOperation(body)).toEqual({ isMutation: false, fields: [] })
  })
})

describe("withRefreshTokenVariable", () => {
  it("replaces any client-supplied refresh token with the cookie value", () => {
    const body = { query: refreshMutation, variables: { refreshToken: "stolen-token" } }

    expect(withRefreshTokenVariable(body, ["refreshSession"], "cookie-token")).toEqual({
      query: refreshMutation,
      variables: { refreshToken: "cookie-token" }
    })
  })

  it("sends an empty token when the visitor has no cookie", () => {
    expect(withRefreshTokenVariable({ query: logoutMutation }, ["logout"], null)).toEqual({
      query: logoutMutation,
      variables: { refreshToken: "" }
    })
  })

  it("leaves unrelated operations untouched", () => {
    const body = { query: "{ __typename }" }

    expect(withRefreshTokenVariable(body, [], "cookie-token")).toBe(body)
  })
})

describe("extractSessionCookie", () => {
  it("moves the issued refresh token out of the response body", () => {
    const payload = {
      data: { verifyMagicLink: { accessToken: "access", refreshToken: "secret", user: { id: "user-1" } } }
    }

    const outcome = extractSessionCookie(payload, ["verifyMagicLink"])

    expect(outcome.token).toBe("secret")
    expect(outcome.clear).toBe(false)
    expect(outcome.body).toEqual({
      data: { verifyMagicLink: { accessToken: "access", refreshToken: null, user: { id: "user-1" } } }
    })
    expect(JSON.stringify(outcome.body)).not.toContain("secret")
  })

  it("asks to clear the cookie after a successful logout", () => {
    expect(extractSessionCookie({ data: { logout: true } }, ["logout"])).toMatchObject({ token: null, clear: true })
    expect(extractSessionCookie({ data: { logoutAll: true } }, ["logoutAll"])).toMatchObject({ clear: true })
  })

  it("keeps the cookie when logout itself failed", () => {
    const payload = { data: { logout: null }, errors: [{ message: "Authentication required" }] }

    expect(extractSessionCookie(payload, ["logout"])).toMatchObject({ token: null, clear: false })
  })

  it("clears the cookie when the refresh was rejected", () => {
    const payload = { data: null, errors: [{ message: "Authentication required" }] }

    expect(extractSessionCookie(payload, ["refreshSession"])).toMatchObject({ token: null, clear: true })
  })

  it("leaves a response without session fields untouched", () => {
    const payload = { data: { __typename: "Query" } }

    expect(extractSessionCookie(payload, [])).toEqual({ body: payload, token: null, clear: false })
  })
})

describe("isSameOriginMutation", () => {
  it.each([
    [
      "a same-origin browser request",
      { origin: "https://altera.test", secFetchSite: "same-origin", host: "altera.test" }
    ],
    ["a typed-in address", { secFetchSite: "none", host: "altera.test" }],
    ["an internal SSR call", { host: "altera.test" }]
  ])("accepts %s", (_name, headers) => {
    expect(isSameOriginMutation(headers)).toBe(true)
  })

  it.each([
    ["a cross-site fetch", { origin: "https://evil.test", secFetchSite: "cross-site", host: "altera.test" }],
    ["a foreign origin without the fetch metadata", { origin: "https://evil.test", host: "altera.test" }],
    ["a sibling site", { origin: "https://other.altera.test", secFetchSite: "same-site", host: "altera.test" }],
    ["a malformed origin", { origin: "not-a-url", host: "altera.test" }]
  ])("rejects %s", (_name, headers) => {
    expect(isSameOriginMutation(headers)).toBe(false)
  })
})

describe("refresh cookie lifetime", () => {
  it("matches the thirty-day session window of the API", () => {
    expect(REFRESH_COOKIE_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 30)
  })
})
