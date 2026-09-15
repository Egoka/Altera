import { GraphQLProxyError, proxyGraphQLRequest } from "../utils/graphqlProxy"

export default defineEventHandler(async (event) => {
  try {
    const result = await proxyGraphQLRequest({
      graphqlApiUrl: useRuntimeConfig(event).graphqlApiUrl,
      body: await readBody<unknown>(event),
      authorization: getHeader(event, "authorization"),
      fetchRaw: (url, options) => $fetch.raw(url, options)
    })

    setResponseStatus(event, result.status)
    setResponseHeader(event, "content-type", result.contentType)
    return result.body
  } catch (error) {
    if (error instanceof GraphQLProxyError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message, message: error.message })
    }

    throw error
  }
})
