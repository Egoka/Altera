import { describe, expect, it } from "vitest"
import { loginErrorKind, verifyErrorState } from "../app/utils/authStates"
import { sanitizeNextPath } from "../app/utils/nextPath"

// Таблицы состояний: docs/spec/20-public/login.md §8, docs/spec/20-public/verify.md §8.
describe("login page states", () => {
  it.each([
    ["RATE_LIMITED", undefined, "rateLimited"],
    ["PROVIDER_UNAVAILABLE", undefined, "providerUnavailable"],
    ["VALIDATION_ERROR", "email", "invalidEmail"],
    ["VALIDATION_ERROR", "consentVersion", "consentRequired"],
    ["INTERNAL_ERROR", undefined, "generic"],
    [undefined, undefined, "generic"]
  ])("maps %s/%s to the %s message", (code, field, expected) => {
    expect(loginErrorKind(code, field)).toBe(expected)
  })
})

describe("verify page states", () => {
  it.each([
    ["NOT_FOUND", "invalid"],
    ["RATE_LIMITED", "rate_limited"],
    ["INTERNAL_ERROR", "error"],
    ["VALIDATION_ERROR", "error"],
    [undefined, "error"]
  ])("maps %s to the %s state", (code, expected) => {
    expect(verifyErrorState(code)).toBe(expected)
  })
})

describe("next path on the login page", () => {
  it.each(["/me", "/me/articles?tab=draft", "/en/login"])("keeps the relative path %s", (value) => {
    expect(sanitizeNextPath(value)).toBe(value)
  })

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "me", "", 42, null])("drops %j", (value) => {
    expect(sanitizeNextPath(value)).toBeNull()
  })
})
