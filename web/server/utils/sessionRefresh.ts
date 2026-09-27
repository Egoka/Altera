/**
 * Обмен refresh на новую пару токенов делает BFF, а не браузер: refresh лежит в httpOnly-cookie
 * и в браузерный JS не попадает (ADR-0023 п. 2–3). Access живёт 15 минут, refresh — 30 дней,
 * поэтому истёкший access меняется здесь, а не превращается в повторный вход
 * (`docs/spec/50-access/session-lifecycle.md` §2.5).
 *
 * Значение переменной подставляет BFF из cookie, как и в операции `RefreshSession`
 * (`web/app/graphql/operations/common/auth.graphql`); `user` здесь не выбирается — маршруту
 * нужны только токены.
 */
export const REFRESH_SESSION_MUTATION =
  'mutation RefreshSession($refreshToken: String! = "") { refreshSession(refreshToken: $refreshToken) { accessToken refreshToken } }'

/**
 * Cookie сессии: httpOnly, `secure`, `lax`, путь всего сайта (ADR-0023 п. 2). Путь совпадает с
 * `SESSION_COOKIE_PATH` из `web/shared/session.ts`; здесь он литералом, потому что этот модуль
 * читают и тесты Node без алиасов Nuxt.
 */
export const SESSION_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const

/** Код ошибки API для запроса без действующей сессии (`server/src/errors/dictionary.ts`). */
const UNAUTHENTICATED_CODE = "UNAUTHENTICATED"

/**
 * Операции, распоряжающиеся сессией сами: обменивать за них refresh нельзя. `refreshSession` —
 * это и есть обмен, выход закрывает сессию, а ветки входа приносят свою пару.
 */
const SESSION_OWN_FIELDS = new Set([
  "refreshSession",
  "logout",
  "logoutAll",
  "verifyMagicLink",
  "acceptConsent",
  "restoreAccountSelf",
  "confirmAccountArchive"
])

/** Сколько результат обмена остаётся общим для запросов, предъявивших прежний токен. */
export const REFRESH_EXCHANGE_TTL_MS = 30_000
// Верхняя граница памяти реестра: завершённые записи вытесняются в порядке появления.
const MAX_TRACKED_EXCHANGES = 500

export interface RefreshedSession {
  accessToken: string
  refreshToken: string
}

export type RefreshOutcome =
  | { status: "refreshed"; session: RefreshedSession }
  /** API не признал предъявленный токен: сессия мертва, cookie пора стирать. */
  | { status: "rejected" }
  /** Ответа нет или он непонятен: сессия может быть жива, cookie не трогаем. */
  | { status: "unavailable" }

export interface UpstreamResult {
  status: number
  contentType: string
  body: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Ответ API с кодом `UNAUTHENTICATED`: access-токена нет или он истёк. */
export function isUnauthenticated(payload: unknown): boolean {
  if (!isRecord(payload) || !Array.isArray(payload.errors)) return false

  return payload.errors.some(
    (error) => isRecord(error) && isRecord(error.extensions) && error.extensions.code === UNAUTHENTICATED_CODE
  )
}

/** Операции, которым обмен и повтор запроса имеют смысл. */
export function isRefreshableRequest(fields: readonly string[]): boolean {
  return !fields.some((field) => SESSION_OWN_FIELDS.has(field))
}

/** Разбирает ответ API на мутацию обмена. */
export async function exchangeRefreshToken(
  presentedToken: string,
  send: (body: { query: string; variables: Record<string, unknown> }) => Promise<UpstreamResult>
): Promise<RefreshOutcome> {
  let payload: unknown
  try {
    payload = (await send({ query: REFRESH_SESSION_MUTATION, variables: { refreshToken: presentedToken } })).body
  } catch {
    return { status: "unavailable" }
  }

  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null
  const refreshed = data && isRecord(data.refreshSession) ? data.refreshSession : null
  const accessToken = typeof refreshed?.accessToken === "string" ? refreshed.accessToken : null
  const refreshToken = typeof refreshed?.refreshToken === "string" ? refreshed.refreshToken : null

  if (accessToken && refreshToken) return { status: "refreshed", session: { accessToken, refreshToken } }
  if (isUnauthenticated(payload)) return { status: "rejected" }

  return { status: "unavailable" }
}

export interface NavigationExchangeCheck {
  method: string
  path: string
  accept: string | undefined
  accessCookie: string | undefined
  refreshCookie: string | undefined
}

/**
 * Обмен до рендера нужен только навигации страницы, у которой access-cookie уже истекла, а
 * refresh жива. Внутренние вызовы страницы (`/api/*`), ресурсы сборки (`/_nuxt/*`) и файлы с
 * общим кешем (ленты, `sitemap.xml`, `robots.txt`) исключены: там `Set-Cookie` либо бесполезен,
 * либо попал бы в кеш, общий для всех читателей.
 */
export function needsNavigationExchange({
  method,
  path,
  accept,
  accessCookie,
  refreshCookie
}: NavigationExchangeCheck): boolean {
  if (method !== "GET" && method !== "HEAD") return false
  if (!refreshCookie || accessCookie) return false

  const route = path.split("?")[0] ?? ""
  if (route.startsWith("/api/") || route.startsWith("/_")) return false
  if (/\.[a-z0-9]+$/i.test(route)) return false

  return (accept ?? "").includes("text/html")
}

export interface RefreshExchangeStore {
  run(presentedToken: string, exchange: () => Promise<RefreshOutcome>): Promise<RefreshOutcome>
}

interface TrackedExchange {
  outcome: Promise<RefreshOutcome>
  /** `null`, пока обмен идёт; иначе момент, после которого результат перестаёт быть общим. */
  expiresAt: number | null
}

/**
 * Один обмен на предъявленный токен. Вкладки просыпаются вместе, и без общего обмена вторая
 * предъявила бы уже ротированный токен — сервер читает это как кражу и отзывает все сессии
 * пользователя (`session-lifecycle.md` §2.4). Результат держится ещё `ttlMs` после завершения:
 * запрос второй вкладки уходит со старой cookie и приходит, когда обмен уже закончился.
 */
export function createRefreshExchangeStore({
  ttlMs = REFRESH_EXCHANGE_TTL_MS,
  now = () => Date.now()
}: { ttlMs?: number; now?: () => number } = {}): RefreshExchangeStore {
  const tracked = new Map<string, TrackedExchange>()

  const settled = (entry: TrackedExchange, moment: number): boolean =>
    entry.expiresAt !== null && entry.expiresAt <= moment

  const prune = (moment: number) => {
    for (const [token, entry] of tracked) {
      if (settled(entry, moment)) tracked.delete(token)
    }

    for (const [token, entry] of tracked) {
      if (tracked.size <= MAX_TRACKED_EXCHANGES) break
      if (entry.expiresAt !== null) tracked.delete(token)
    }
  }

  return {
    run(presentedToken, exchange) {
      prune(now())
      const known = tracked.get(presentedToken)
      if (known) return known.outcome

      const outcome = exchange().then(
        (result) => {
          const entry = tracked.get(presentedToken)
          // Недоступный апстрим не запоминается: следующий запрос пробует обмен снова.
          if (result.status === "unavailable") tracked.delete(presentedToken)
          else if (entry) entry.expiresAt = now() + ttlMs
          return result
        },
        (error) => {
          tracked.delete(presentedToken)
          throw error
        }
      )

      tracked.set(presentedToken, { outcome, expiresAt: null })
      return outcome
    }
  }
}

/** Реестр процесса Nitro: маршрут `/api/graphql` и обмен при SSR пользуются одним и тем же. */
export const sessionRefreshExchanges = createRefreshExchangeStore()

export interface SessionRequestOptions {
  /** Корневые поля мутации запроса; у запросов и подписок — пустой список. */
  fields: readonly string[]
  refreshToken: string | null
  accessToken: string | null
  send: (session: { refreshToken: string | null; accessToken: string | null }) => Promise<UpstreamResult>
  refresh: (presentedToken: string) => Promise<RefreshOutcome>
}

export interface SessionRequestOutcome {
  result: UpstreamResult
  /** Выданная обменом пара: её пишет в cookie вызывающая сторона. */
  session: RefreshedSession | null
  /** Сессия мертва: cookie пора стирать. */
  clear: boolean
}

/**
 * Запрос к API с одним обменом refresh по ответу `UNAUTHENTICATED` и одной попыткой повтора:
 * второй отказ означает, что сессия действительно мертва, а не что истёк access (ADR-0023 п. 3).
 */
export async function sendWithSessionRefresh({
  fields,
  refreshToken,
  accessToken,
  send,
  refresh
}: SessionRequestOptions): Promise<SessionRequestOutcome> {
  const first = await send({ refreshToken, accessToken })
  if (!refreshToken || !isRefreshableRequest(fields) || !isUnauthenticated(first.body)) {
    return { result: first, session: null, clear: false }
  }

  const outcome = await refresh(refreshToken)
  if (outcome.status === "refreshed") {
    return {
      result: await send({ refreshToken: outcome.session.refreshToken, accessToken: outcome.session.accessToken }),
      session: outcome.session,
      clear: false
    }
  }

  return { result: first, session: null, clear: outcome.status === "rejected" }
}

/**
 * Обновлённая пара подставляется в заголовки самого запроса: SSR читает cookie из них, а не из
 * ответа, поэтому иначе `auth.global` увёл бы вошедшего на вход, а BFF пошёл бы к API с прежним
 * токеном. Значение `null` убирает cookie.
 */
export function withUpdatedCookies(header: string | undefined, updates: Record<string, string | null>): string {
  const cookieName = (part: string): string => {
    const separator = part.indexOf("=")
    return separator === -1 ? part : part.slice(0, separator)
  }
  const kept = (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !Object.hasOwn(updates, cookieName(part)))
  const written = Object.entries(updates).flatMap(([name, value]) => (value === null ? [] : [`${name}=${value}`]))

  return [...kept, ...written].join("; ")
}
