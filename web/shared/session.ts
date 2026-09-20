// Браузер не видит токенов: BFF кладёт их в httpOnly-cookie и сам подставляет в запрос к API
// (ADR-0023, docs/spec/50-access/session-lifecycle.md п. 3). Ротация и выход — T-023.
export const SESSION_ACCESS_COOKIE = "altera_access"
export const SESSION_REFRESH_COOKIE = "altera_refresh"

export const SESSION_COOKIE_PATH = "/"
