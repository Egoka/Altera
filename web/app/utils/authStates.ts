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

/**
 * Ветка пароля (T-115, `docs/spec/20-public/login.md` §3а): регистрация с паролем, вход, сброс
 * и смена пароля в кабинете. Неверный адрес и неверный пароль дают один и тот же
 * `UNAUTHENTICATED` — интерфейс тоже не должен различать их сообщением.
 */
export type PasswordErrorKind =
  | "invalidEmail"
  | "consentRequired"
  | "weakPassword"
  | "knownPassword"
  | "wrongCredentials"
  | "wrongCurrentPassword"
  | "rateLimited"
  | "providerUnavailable"
  | "generic"

export function passwordErrorKind(input: { code: unknown; field: unknown; rule: unknown }): PasswordErrorKind {
  if (input.code === "RATE_LIMITED") return "rateLimited"
  if (input.code === "PROVIDER_UNAVAILABLE") return "providerUnavailable"
  if (input.code === "UNAUTHENTICATED") return "wrongCredentials"
  if (input.code === "VALIDATION_ERROR") {
    if (input.field === "email") return "invalidEmail"
    if (input.field === "consentVersion") return "consentRequired"
    if (input.field === "currentPassword") return "wrongCurrentPassword"
    return input.rule === "known password" ? "knownPassword" : "weakPassword"
  }

  return "generic"
}

/** Экран установки нового пароля по ссылке из письма (`/auth/reset`). */
export type PasswordResetState = "form" | "invalid" | "error"

export function passwordResetState(code: unknown): PasswordResetState {
  if (code === "NOT_FOUND") return "invalid"
  return "error"
}
