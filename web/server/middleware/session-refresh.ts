import { SESSION_ACCESS_COOKIE } from "#shared/session"
import { resolveTrustedClientAddress } from "../utils/clientAddress"
import { proxyGraphQLRequest } from "../utils/graphqlProxy"
import { nitroFetchRaw } from "../utils/nitroFetch"
import {
  ACCESS_COOKIE_MAX_AGE_SECONDS,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  REFRESH_COOKIE_NAME
} from "../utils/sessionCookie"
import {
  SESSION_COOKIE_OPTIONS,
  exchangeRefreshToken,
  needsNavigationExchange,
  sessionRefreshExchanges,
  withUpdatedCookies
} from "../utils/sessionRefresh"

/**
 * Через 15 минут браузер перестаёт присылать access-cookie, и навигация вошедшего выглядела бы
 * навигацией гостя: `auth.global` увёл бы её на вход, хотя refresh-cookie жива 30 дней
 * (ADR-0023 п. 3, `docs/spec/50-access/session-lifecycle.md` §2.5). Поэтому BFF обменивает
 * refresh здесь — до маршрутов, рендера и запросов страницы к `/api/graphql`.
 *
 * Обмен идёт только для навигации страницы (`needsNavigationExchange`): внутренние вызовы,
 * ресурсы сборки и файлы с общим кешем исключены.
 */
export default defineEventHandler(async (event) => {
  const presentedToken = getCookie(event, REFRESH_COOKIE_NAME)
  if (!presentedToken) return
  const exchangeable = needsNavigationExchange({
    method: event.method,
    path: event.path,
    accept: getHeader(event, "accept"),
    accessCookie: getCookie(event, SESSION_ACCESS_COOKIE),
    refreshCookie: presentedToken
  })
  if (!exchangeable) return

  const requestId = event.context.requestId
  if (typeof requestId !== "string") return

  const runtimeConfig = useRuntimeConfig(event)
  const outcome = await sessionRefreshExchanges.run(presentedToken, () =>
    exchangeRefreshToken(presentedToken, (body) =>
      proxyGraphQLRequest({
        graphqlApiUrl: runtimeConfig.graphqlApiUrl,
        body,
        userAgent: getHeader(event, "user-agent"),
        clientIp: resolveTrustedClientAddress({
          forwardedFor: getHeader(event, "x-forwarded-for"),
          socketAddress: getRequestIP(event),
          trustedProxyHops: runtimeConfig.trustedProxyHops
        }),
        requestId,
        requestIdForwardSecret: runtimeConfig.requestIdForwardSecret,
        fetchRaw: nitroFetchRaw
      })
    )
  )

  if (outcome.status === "refreshed") {
    setCookie(event, REFRESH_COOKIE_NAME, outcome.session.refreshToken, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS
    })
    setCookie(event, SESSION_ACCESS_COOKIE, outcome.session.accessToken, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS
    })
    // Рендер читает cookie из заголовков запроса, а не из ответа: без подмены страница всё равно
    // считала бы посетителя гостем, а её запрос к API ушёл бы с прежним токеном.
    event.node.req.headers.cookie = withUpdatedCookies(event.node.req.headers.cookie, {
      [SESSION_ACCESS_COOKIE]: outcome.session.accessToken,
      [REFRESH_COOKIE_NAME]: outcome.session.refreshToken
    })
    return
  }

  // Мёртвая сессия: cookie стирается сразу, иначе обмен повторяется на каждой навигации.
  if (outcome.status === "rejected") {
    deleteCookie(event, REFRESH_COOKIE_NAME, SESSION_COOKIE_OPTIONS)
    deleteCookie(event, SESSION_ACCESS_COOKIE, SESSION_COOKIE_OPTIONS)
    event.node.req.headers.cookie = withUpdatedCookies(event.node.req.headers.cookie, {
      [SESSION_ACCESS_COOKIE]: null,
      [REFRESH_COOKIE_NAME]: null
    })
  }
})
