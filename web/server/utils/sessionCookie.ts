import { Kind, parse, type OperationDefinitionNode } from "graphql"

// ADR-0023 п. 2: refresh живёт в httpOnly-cookie первого домена, в браузерный JS не попадает.
export const REFRESH_COOKIE_NAME = "altera_refresh"
// Срок cookie совпадает со сроком сессии на сервере (ADR-0009 п. 1).
export const REFRESH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
// Access живёт 15 минут (`50-access/session-lifecycle.md` п. 5).
export const ACCESS_COOKIE_MAX_AGE_SECONDS = 15 * 60

// Мутации, которым BFF подставляет refresh из cookie вместо клиента.
const REFRESH_INPUT_FIELDS = new Set(["refreshSession", "logout"])
// Мутации, ответ которых содержит новый refresh. Самостоятельное восстановление аккаунта здесь
// потому, что меняет ограниченную сессию на полную (`30-account/reader/archived-state.md` §4);
// ветка пароля (T-115) — потому, что вход, подтверждение адреса и сброс выдают сессию так же,
// как подтверждение ссылки, и refresh из их ответа браузеру тоже не показывается.
const REFRESH_OUTPUT_FIELDS = new Set([
  "verifyMagicLink",
  "acceptConsent",
  "refreshSession",
  "restoreAccountSelf",
  "loginWithPassword",
  "confirmEmail",
  "resetPassword"
])
// По контракту входа (T-022) ветки подтверждения ссылки возвращают сессию вложенным полем,
// а `refreshSession` — плоской полезной нагрузкой. Ищется и то, и другое.
const NESTED_SESSION_FIELD = "session"
/**
 * Мутации, после успеха которых cookie стирается. Успех читается либо по самому результату
 * (`logout` отвечает `true`), либо по флагу в нём: подтверждение архива аккаунта отзывает все
 * сессии в той же транзакции (`50-access/session-lifecycle.md` п. 7), и держать их cookie
 * незачем — иначе интерфейс ещё 15 минут считает пользователя вошедшим.
 */
const SESSION_END_FIELDS = new Map<string, string | null>([
  ["logout", null],
  ["logoutAll", null],
  ["confirmAccountArchive", "archived"]
])
// Обмен одноразового токена входа: полномочие даёт секрет в теле запроса, а не cookie браузера.
// Подтверждение адреса из письма ветки пароля — такой же межсайтовый переход по ссылке.
const LOGIN_EXCHANGE_FIELDS = new Set(["verifyMagicLink", "acceptConsent", "confirmEmail"])

export interface ParsedOperation {
  isMutation: boolean
  fields: readonly string[]
}

export interface SessionCookieOutcome {
  body: unknown
  token: string | null
  /**
   * Новый access-токен той же сессии. Мутация, заменившая сессию без перезагрузки страницы
   * (восстановление аккаунта), иначе оставила бы в браузере токен уже отозванной сессии.
   */
  accessToken: string | null
  clear: boolean
}

export interface RequestOriginHeaders {
  origin?: string
  secFetchSite?: string
  host?: string
}

export interface LoginExchangeHeaders {
  secFetchMode?: string
  contentType?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Имена полей мутации верхнего уровня: по ним решается, нужна ли cookie-логика. */
export function readOperation(body: unknown): ParsedOperation {
  const empty: ParsedOperation = { isMutation: false, fields: [] }
  if (!isRecord(body) || typeof body.query !== "string") return empty

  let definitions: readonly OperationDefinitionNode[]
  try {
    definitions = parse(body.query).definitions.filter(
      (definition): definition is OperationDefinitionNode => definition.kind === Kind.OPERATION_DEFINITION
    )
  } catch {
    // Синтаксическую ошибку сообщит API; BFF в этом случае ничего не подставляет.
    return empty
  }

  const operationName = typeof body.operationName === "string" ? body.operationName : null
  const operation = operationName
    ? definitions.find((definition) => definition.name?.value === operationName)
    : definitions.length === 1
      ? definitions[0]
      : undefined

  if (!operation || operation.operation !== "mutation") return empty

  return {
    isMutation: true,
    fields: operation.selectionSet.selections.flatMap((selection) =>
      selection.kind === Kind.FIELD ? [selection.name.value] : []
    )
  }
}

/**
 * Значение всегда берётся из cookie: браузер не может подставить чужой refresh
 * даже собственной переменной запроса.
 */
export function withRefreshTokenVariable(body: unknown, fields: readonly string[], cookie: string | null): unknown {
  if (!isRecord(body) || !fields.some((field) => REFRESH_INPUT_FIELDS.has(field))) return body

  const variables = isRecord(body.variables) ? body.variables : {}
  return { ...body, variables: { ...variables, refreshToken: cookie ?? "" } }
}

/** Снимает refresh из ответа API и сообщает, что делать с cookie. */
export function extractSessionCookie(payload: unknown, fields: readonly string[]): SessionCookieOutcome {
  if (!isRecord(payload) || fields.length === 0) {
    return { body: payload, token: null, accessToken: null, clear: false }
  }

  const data = isRecord(payload.data) ? payload.data : null
  const failed = Array.isArray(payload.errors) && payload.errors.length > 0
  let token: string | null = null
  let accessToken: string | null = null
  let sanitizedData = data

  for (const field of fields) {
    if (!REFRESH_OUTPUT_FIELDS.has(field)) continue
    const result = sanitizedData?.[field]
    if (!isRecord(result)) continue

    const nested = isRecord(result[NESTED_SESSION_FIELD])
      ? (result[NESTED_SESSION_FIELD] as Record<string, unknown>)
      : null
    const carrier = typeof result.refreshToken === "string" ? result : nested
    if (!carrier || typeof carrier.refreshToken !== "string" || carrier.refreshToken.length === 0) continue

    token = carrier.refreshToken
    accessToken = typeof carrier.accessToken === "string" ? carrier.accessToken : null
    sanitizedData = {
      ...sanitizedData,
      [field]:
        carrier === result
          ? { ...result, refreshToken: null }
          : { ...result, [NESTED_SESSION_FIELD]: { ...carrier, refreshToken: null } }
    }
  }

  const endedSession = fields.some((field) => {
    if (!SESSION_END_FIELDS.has(field)) return false
    const flag = SESSION_END_FIELDS.get(field) ?? null
    const result = data?.[field]
    return flag === null ? result === true : isRecord(result) && result[flag] === true
  })
  // Неудачное обновление означает мёртвую сессию — держать её cookie незачем.
  const refreshRejected = fields.includes("refreshSession") && failed && !data?.refreshSession

  return {
    body: sanitizedData === data ? payload : { ...payload, data: sanitizedData },
    token,
    accessToken,
    clear: token === null && (endedSession || refreshRejected)
  }
}

/**
 * Единственное исключение из проверки происхождения: обмен одноразового токена входа. Ссылка
 * открывается из веб-почты, и браузер помечает такой переход как `sec-fetch-site: cross-site`,
 * поэтому иначе вход из письма отвечает 403 (`docs/spec/20-public/verify.md` §3). CSRF на этих
 * мутациях не действует — полномочие даёт секрет из письма, а не cookie браузера, и чужая
 * страница его не знает. Исключение сужено так, чтобы им нельзя было прикрыть другую мутацию:
 * в операции нет иных корневых полей, тело — `application/json` (простая форма со чужого сайта
 * его без CORS не отправит), а запрос является переходом документа, а не фоновым вызовом.
 */
export function isLoginTokenExchange(
  fields: readonly string[],
  { secFetchMode, contentType }: LoginExchangeHeaders
): boolean {
  if (fields.length === 0 || !fields.every((field) => LOGIN_EXCHANGE_FIELDS.has(field))) return false
  if (contentType !== undefined && !contentType.startsWith("application/json")) return false
  return secFetchMode === undefined || secFetchMode === "navigate"
}

/**
 * Cookie-аутентификация делает мутации уязвимыми к CSRF, поэтому маршрут проверяет
 * происхождение запроса (ADR-0023 п. 4). SSR-вызов Nitro приходит без обоих заголовков.
 */
export function isSameOriginMutation({ origin, secFetchSite, host }: RequestOriginHeaders): boolean {
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") return false
  if (!origin) return true

  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
