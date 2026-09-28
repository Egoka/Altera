import { SESSION_ACCESS_COOKIE } from "#shared/session"
import { resolveTrustedClientAddress } from "../utils/clientAddress"
import {
  GraphQLProxyError,
  getGraphQLRouteError,
  isMultipartRequest,
  proxyGraphQLRequest,
  proxyGraphQLUpload
} from "../utils/graphqlProxy"
import { nitroFetchRaw } from "../utils/nitroFetch"
import {
  ACCESS_COOKIE_MAX_AGE_SECONDS,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  REFRESH_COOKIE_NAME,
  extractSessionCookie,
  isLoginTokenExchange,
  isSameOriginMutation,
  readOperation,
  withRefreshTokenVariable
} from "../utils/sessionCookie"
import {
  SESSION_COOKIE_OPTIONS,
  exchangeRefreshToken,
  sendWithSessionRefresh,
  sessionRefreshExchanges,
  type UpstreamResult
} from "../utils/sessionRefresh"

export default defineEventHandler(async (event) => {
  const requestId = event.context.requestId
  if (typeof requestId !== "string") throw new Error("Request ID middleware is not initialized")

  try {
    const runtimeConfig = useRuntimeConfig(event)
    const requestContentType = getHeader(event, "content-type")
    // Загрузка файла приходит multipart-запросом GraphQL (`uploadMedia`, T-063): такое тело
    // читается сырым буфером и уходит наверх как есть — разбирать и собирать форму заново
    // значило бы ломать границы конверта.
    const upload = isMultipartRequest(requestContentType)
    const body = upload ? await readRawBody(event, false) : await readBody<unknown>(event)
    // Операция конверта не читается: загрузка — всегда мутация, и проверка происхождения ниже
    // применяется к ней без разбора тела.
    const operation = upload ? { isMutation: true, fields: [] as readonly string[] } : readOperation(body)

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
    const authorization = getHeader(event, "authorization")
    const sharedUpstream = (accessToken: string | null) =>
      ({
        graphqlApiUrl: runtimeConfig.graphqlApiUrl,
        authorization: authorization ?? (accessToken ? `Bearer ${accessToken}` : undefined),
        userAgent: getHeader(event, "user-agent"),
        clientIp: resolveTrustedClientAddress({
          forwardedFor: getHeader(event, "x-forwarded-for"),
          socketAddress: getRequestIP(event),
          trustedProxyHops: runtimeConfig.trustedProxyHops
        }),
        requestId,
        requestIdForwardSecret: runtimeConfig.requestIdForwardSecret,
        fetchRaw: nitroFetchRaw
      }) as const

    /** Обычная операция JSON-телом: ею же идёт обмен refresh, даже когда запрос был загрузкой. */
    const jsonUpstream = (payload: unknown, accessToken: string | null): Promise<UpstreamResult> =>
      proxyGraphQLRequest({ ...sharedUpstream(accessToken), body: payload })

    const upstream = (payload: unknown, accessToken: string | null): Promise<UpstreamResult> =>
      upload
        ? proxyGraphQLUpload({
            ...sharedUpstream(accessToken),
            body: Buffer.isBuffer(payload) ? payload : Buffer.alloc(0),
            contentType: requestContentType
          })
        : jsonUpstream(payload, accessToken)

    // Истёкший access меняется на новый по ответу `UNAUTHENTICATED`, и запрос повторяется один
    // раз: через 15 минут вошедший иначе видел бы страницу гостя (ADR-0023 п. 3).
    const refreshed = await sendWithSessionRefresh({
      fields: operation.fields,
      refreshToken: getCookie(event, REFRESH_COOKIE_NAME) ?? null,
      accessToken: getCookie(event, SESSION_ACCESS_COOKIE) ?? null,
      send: ({ refreshToken, accessToken }) =>
        upstream(withRefreshTokenVariable(body, operation.fields, refreshToken), accessToken),
      refresh: (presentedToken) =>
        sessionRefreshExchanges.run(presentedToken, () =>
          exchangeRefreshToken(presentedToken, (refreshBody) => jsonUpstream(refreshBody, null))
        )
    })

    const result = refreshed.result
    const session = extractSessionCookie(result.body, operation.fields)
    const issued = session.token ? { refreshToken: session.token, accessToken: session.accessToken } : refreshed.session

    if (issued) {
      setCookie(event, REFRESH_COOKIE_NAME, issued.refreshToken, {
        ...SESSION_COOKIE_OPTIONS,
        maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS
      })
      // Мутация, заменившая сессию, обновляет и access-cookie: страница, сделавшая её из
      // браузера (восстановление аккаунта, `archived-state.md` §4), иначе продолжила бы
      // предъявлять токен отозванной сессии до конца его 15 минут. Обмен refresh выдаёт новый
      // access по той же причине.
      if (issued.accessToken) {
        setCookie(event, SESSION_ACCESS_COOKIE, issued.accessToken, {
          ...SESSION_COOKIE_OPTIONS,
          maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS
        })
      }
    } else if (session.clear || refreshed.clear) {
      deleteCookie(event, REFRESH_COOKIE_NAME, SESSION_COOKIE_OPTIONS)
      // Выход обязан очистить cookie (`30-account/reader/sessions.md` §7): без этого шага
      // access-cookie живёт ещё 15 минут и интерфейс продолжает считать читателя вошедшим,
      // хотя API уже отвечает `UNAUTHENTICATED` по отозванной сессии.
      deleteCookie(event, SESSION_ACCESS_COOKIE, SESSION_COOKIE_OPTIONS)
    }

    setResponseStatus(event, result.status)
    setResponseHeader(event, "content-type", result.contentType)
    return session.body
  } catch (error) {
    throw createError(getGraphQLRouteError(error, requestId))
  }
})
