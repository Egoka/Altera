import { SESSION_ACCESS_COOKIE } from "#shared/session"
import { getGraphQLRouteError, proxyGraphQLRequest } from "../utils/graphqlProxy"

export default defineEventHandler(async (event) => {
  const requestId = event.context.requestId
  if (typeof requestId !== "string") throw new Error("Request ID middleware is not initialized")

  try {
    const runtimeConfig = useRuntimeConfig(event)
    // Браузер токенов не видит: сессия живёт в httpOnly-cookie, и подставляет её BFF
    // (ADR-0023). Явный заголовок остаётся для серверных и тестовых вызовов.
    const sessionToken = getCookie(event, SESSION_ACCESS_COOKIE)
    const result = await proxyGraphQLRequest({
      graphqlApiUrl: runtimeConfig.graphqlApiUrl,
      body: await readBody<unknown>(event),
      authorization: getHeader(event, "authorization") ?? (sessionToken ? `Bearer ${sessionToken}` : undefined),
      requestId,
      requestIdForwardSecret: runtimeConfig.requestIdForwardSecret,
      fetchRaw: (url, options) => $fetch.raw(url, options)
    })

    setResponseStatus(event, result.status)
    setResponseHeader(event, "content-type", result.contentType)
    return result.body
  } catch (error) {
    throw createError(getGraphQLRouteError(error, requestId))
  }
})
