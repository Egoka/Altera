// Таблицы состояний страниц входа и подтверждения:
// docs/spec/20-public/login.md §8 и docs/spec/20-public/verify.md §8.
// Коды ошибок — ADR-0032 / docs/spec/00-registries/errors.md.

export type LoginErrorKind = "invalidEmail" | "consentRequired" | "rateLimited" | "providerUnavailable" | "generic"

export function loginErrorKind(code: unknown, field: unknown): LoginErrorKind {
  if (code === "RATE_LIMITED") return "rateLimited"
  if (code === "PROVIDER_UNAVAILABLE") return "providerUnavailable"
  if (code === "VALIDATION_ERROR") return field === "email" ? "invalidEmail" : "consentRequired"
  return "generic"
}

export type VerifyState = "loading" | "invalid" | "rate_limited" | "consent" | "blocked" | "error"

export function verifyErrorState(code: unknown): VerifyState {
  if (code === "NOT_FOUND") return "invalid"
  if (code === "RATE_LIMITED") return "rate_limited"
  return "error"
}
