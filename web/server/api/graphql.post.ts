import { SESSION_ACCESS_COOKIE, SESSION_COOKIE_PATH } from "#shared/session"
import { resolveTrustedClientAddress } from "../utils/clientAddress"
import { GraphQLProxyError, getGraphQLRouteError, proxyGraphQLRequest } from "../utils/graphqlProxy"
import {
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  REFRESH_COOKIE_NAME,
  extractSessionCookie,
  isLoginTokenExchange,
  isSameOriginMutation,
  readOperation,
  withRefreshTokenVariable
} from "../utils/sessionCookie"

const refreshCookieOptions = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const
const accessCookieOptions = { httpOnly: true, sameSite: "lax", path: SESSION_COOKIE_PATH } as const

export default defineEventHandler(async (event) => {
  const requestId = event.context.requestId
  if (typeof requestId !== "string") throw new Error("Request ID middleware is not initialized")

  try {
    const runtimeConfig = useRuntimeConfig(event)
    const body = await readBody<unknown>(event)
    const operation = readOperation(body)

    // Обмен токена входа приходит из письма как межсайтовый переход и проверку происхождения
    // не проходит; для остальных мутаций она остаётся (ADR-0023 п. 4).
    const loginExchange = isLoginTokenExchange(operation.fields, {
      secFetchMode: getHeader(event, "sec-fetch-mode"),
      contentType: getHeader(event, "content-type")
    })

    if (
      operation.isMutation &&
      !loginExchange &&
      !isSameOriginMutation({
        origin: getHeader(event, "origin"),
        secFetchSite: getHeader(event, "sec-fetch-site"),
        host: getHeader(event, "host")
      })
    ) {
      throw new GraphQLProxyError(403, "Cross-origin mutation rejected")
    }

    // Браузер токенов не видит (ADR-0023): токен доступа лежит в cookie и подставляется здесь,
    // refresh живёт в отдельной httpOnly-cookie и попадает в переменные мутации ниже.
    // Явный заголовок остаётся для серверных и тестовых вызовов и имеет приоритет.
    const accessToken = getCookie(event, SESSION_ACCESS_COOKIE)
    const result = await proxyGraphQLRequest({
      graphqlApiUrl: runtimeConfig.graphqlApiUrl,
      body: withRefreshTokenVariable(body, operation.fields, getCookie(event, REFRESH_COOKIE_NAME) ?? null),
      authorization: getHeader(event, "authorization") ?? (accessToken ? `Bearer ${accessToken}` : undefined),
      userAgent: getHeader(event, "user-agent"),
      // Адрес берётся из элемента `X-Forwarded-For`, который добавил доверенный прокси площадки:
      // самый левый элемент присылает клиент и им снимался бы лимит по адресу (`rate-limits.md`
      // §2 п. 2).
      clientIp: resolveTrustedClientAddress({
        forwardedFor: getHeader(event, "x-forwarded-for"),
        socketAddress: getRequestIP(event),
        trustedProxyHops: runtimeConfig.trustedProxyHops
      }),
      requestId,
      requestIdForwardSecret: runtimeConfig.requestIdForwardSecret,
      fetchRaw: (url, options) => $fetch.raw(url, options)
    })

    const session = extractSessionCookie(result.body, operation.fields)
    if (session.token) {
      setCookie(event, REFRESH_COOKIE_NAME, session.token, {
        ...refreshCookieOptions,
        maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS
      })
    } else if (session.clear) {
      deleteCookie(event, REFRESH_COOKIE_NAME, refreshCookieOptions)
      // Выход обязан очистить cookie (`30-account/reader/sessions.md` §7): без этого шага
      // access-cookie живёт ещё 15 минут и интерфейс продолжает считать читателя вошедшим,
      // хотя API уже отвечает `UNAUTHENTICATED` по отозванной сессии.
      deleteCookie(event, SESSION_ACCESS_COOKIE, accessCookieOptions)
    }

    setResponseStatus(event, result.status)
    setResponseHeader(event, "content-type", result.contentType)
    return session.body
  } catch (error) {
    throw createError(getGraphQLRouteError(error, requestId))
  }
})
