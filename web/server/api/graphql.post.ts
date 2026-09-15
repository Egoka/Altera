import { getGraphQLRouteError, proxyGraphQLRequest } from "../utils/graphqlProxy"

export default defineEventHandler(async (event) => {
  const requestId = event.context.requestId
  if (typeof requestId !== "string") throw new Error("Request ID middleware is not initialized")

  try {
    const runtimeConfig = useRuntimeConfig(event)
    const result = await proxyGraphQLRequest({
      graphqlApiUrl: runtimeConfig.graphqlApiUrl,
      body: await readBody<unknown>(event),
      authorization: getHeader(event, "authorization"),
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
