// Таблицы состояний двух страниц самостоятельного архивирования:
// docs/spec/30-account/reader/delete-account.md §8 и archived-state.md §8,
// развилки — docs/spec/10-flows/delete-account.md §4–5. Коды ошибок — ADR-0032.

/** Строки §8 страницы «Удалить аккаунт», различимые на экране. */
export type AccountArchiveErrorKind = "lastOwner" | "openRequest" | "rateLimited" | "providerUnavailable" | "generic"

interface GraphQLFailure {
  code: unknown
  entity?: unknown
  actual?: unknown
}

/**
 * `CONFLICT` приходит на две разные строки: последний владелец (§4 flow, ветка А) и уже
 * открытый запрос (§5 экрана). Их различает `entity`: инвариант владельцев относится к
 * записи пользователя, открытый запрос — к самому запросу архивирования.
 */
export function accountArchiveErrorKind(failure: GraphQLFailure): AccountArchiveErrorKind {
  const { code, entity, actual } = failure

  if (code === "RATE_LIMITED") return "rateLimited"
  if (code === "PROVIDER_UNAVAILABLE") return "providerUnavailable"
  if (code === "CONFLICT") {
    if (entity === "accountArchive") return "openRequest"
    return actual === "last owner" ? "lastOwner" : "generic"
  }

  return "generic"
}

/** Строки §8 экрана состояния: восстановление отказывает по двум разным причинам. */
export type AccountRestoreErrorKind = "conflict" | "forbidden" | "generic"

export function accountRestoreErrorKind(code: unknown): AccountRestoreErrorKind {
  if (code === "CONFLICT") return "conflict"
  if (code === "FORBIDDEN") return "forbidden"

  return "generic"
}

/**
 * Открытый запрос показывается, только пока действует ссылка: истёкший сервер уже не признаёт,
 * и экран обязан вернуться к кнопке «отправить письмо», а не предлагать ждать (§5, §8).
 */
export function isArchiveRequestExpired(expiresAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false
  const deadline = Date.parse(expiresAt)

  return Number.isFinite(deadline) && deadline <= now.getTime()
}

/**
 * Слово подтверждения (`delete-account.md` §5 `[ДОПУЩЕНИЕ]`). Сравнение без учёта регистра и
 * крайних пробелов: требование «введите слово» проверяет намерение, а не аккуратность набора.
 */
export function isConfirmationWord(entered: string, expected: string): boolean {
  return entered.trim().toLocaleLowerCase() === expected.trim().toLocaleLowerCase()
}
