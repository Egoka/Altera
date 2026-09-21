// Таблица состояний страницы смены почты: docs/spec/30-account/reader/email-change.md §8
// и развилки docs/spec/10-flows/email-change-and-recovery.md §4–5.
// Коды ошибок — ADR-0032 / docs/spec/00-registries/errors.md.

/** Строки §8 и §4, различимые на экране: у каждой свой текст и своё продолжение. */
export type EmailChangeErrorKind =
  | "invalidEmail"
  | "sameEmail"
  | "openRequest"
  | "wrongCode"
  | "expiredCode"
  | "addressTaken"
  | "rateLimited"
  | "providerUnavailable"
  | "generic"

interface EmailChangeFailure {
  code: unknown
  field?: unknown
  entity?: unknown
  rule?: unknown
}

/**
 * `VALIDATION_ERROR` приходит и на адрес, и на код, поэтому строку выбирает поле; `CONFLICT`
 * на шаге адреса означает открытый запрос, а на шаге кода — занятый адрес, поэтому их
 * различает `entity` (`emailChange` против `user`).
 */
export function emailChangeErrorKind(failure: EmailChangeFailure): EmailChangeErrorKind {
  const { code, field, entity, rule } = failure

  if (code === "RATE_LIMITED") return "rateLimited"
  if (code === "PROVIDER_UNAVAILABLE") return "providerUnavailable"
  if (code === "NOT_FOUND") return "expiredCode"
  if (code === "CONFLICT") return entity === "user" ? "addressTaken" : "openRequest"
  if (code === "VALIDATION_ERROR") {
    if (field === "code") return "wrongCode"
    return rule === "different from current" ? "sameEmail" : "invalidEmail"
  }

  return "generic"
}

/** Истёкший код показывается зоной 4 как отдельная строка §8, а не как пустая форма. */
export function isCodeExpired(expiresAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false
  const deadline = Date.parse(expiresAt)

  return Number.isFinite(deadline) && deadline <= now.getTime()
}
