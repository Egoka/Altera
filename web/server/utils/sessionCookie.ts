import { Kind, parse, type OperationDefinitionNode } from "graphql"

// ADR-0023 п. 2: refresh живёт в httpOnly-cookie первого домена, в браузерный JS не попадает.
export const REFRESH_COOKIE_NAME = "altera_refresh"
// Срок cookie совпадает со сроком сессии на сервере (ADR-0009 п. 1).
export const REFRESH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

// Мутации, которым BFF подставляет refresh из cookie вместо клиента.
const REFRESH_INPUT_FIELDS = new Set(["refreshSession", "logout"])
// Мутации, ответ которых содержит новый refresh.
const REFRESH_OUTPUT_FIELDS = new Set(["verifyMagicLink", "acceptConsent", "refreshSession"])
// По контракту входа (T-022) ветки подтверждения ссылки возвращают сессию вложенным полем,
// а `refreshSession` — плоской полезной нагрузкой. Ищется и то, и другое.
const NESTED_SESSION_FIELD = "session"
// Мутации, после успеха которых cookie стирается.
const SESSION_END_FIELDS = new Set(["logout", "logoutAll"])

export interface ParsedOperation {
  isMutation: boolean
  fields: readonly string[]
}

export interface SessionCookieOutcome {
  body: unknown
  token: string | null
  clear: boolean
}

export interface RequestOriginHeaders {
  origin?: string
  secFetchSite?: string
  host?: string
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
  if (!isRecord(payload) || fields.length === 0) return { body: payload, token: null, clear: false }

  const data = isRecord(payload.data) ? payload.data : null
  const failed = Array.isArray(payload.errors) && payload.errors.length > 0
  let token: string | null = null
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
    sanitizedData = {
      ...sanitizedData,
      [field]:
        carrier === result
          ? { ...result, refreshToken: null }
          : { ...result, [NESTED_SESSION_FIELD]: { ...carrier, refreshToken: null } }
    }
  }

  const endedSession = fields.some((field) => SESSION_END_FIELDS.has(field) && data?.[field] === true)
  // Неудачное обновление означает мёртвую сессию — держать её cookie незачем.
  const refreshRejected = fields.includes("refreshSession") && failed && !data?.refreshSession

  return {
    body: sanitizedData === data ? payload : { ...payload, data: sanitizedData },
    token,
    clear: token === null && (endedSession || refreshRejected)
  }
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
