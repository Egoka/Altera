import { createHmac } from "node:crypto"

interface GraphQLRequestBody {
  query: string
  operationName?: string | null
  variables?: Record<string, unknown> | null
}

interface UpstreamResponse {
  status: number
  headers: Headers
  _data?: unknown
}

interface UpstreamRequestOptions {
  method: "POST"
  body: GraphQLRequestBody
  headers: Record<string, string>
  ignoreResponseError: true
}

type FetchRaw = (url: string, options: UpstreamRequestOptions) => Promise<UpstreamResponse>

interface ProxyGraphQLRequestOptions {
  graphqlApiUrl: string
  body: unknown
  authorization?: string
  userAgent?: string
  clientIp?: string
  requestId: string
  requestIdForwardSecret: string
  fetchRaw: FetchRaw
}

interface GraphQLRouteError {
  statusCode: number
  statusMessage: string
  message: string
  data?: { requestId: string }
}

interface HttpClientError {
  statusCode: number
  statusMessage?: string
}

export class GraphQLProxyError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message)
    this.name = "GraphQLProxyError"
  }
}

function isHttpClientError(error: unknown): error is HttpClientError {
  if (!error || typeof error !== "object") return false
  const statusCode = Reflect.get(error, "statusCode")
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500
}

export function getGraphQLRouteError(error: unknown, requestId: string): GraphQLRouteError {
  if (error instanceof GraphQLProxyError) {
    return {
      statusCode: error.statusCode,
      statusMessage: error.message,
      message: error.message,
      ...(error.statusCode >= 500 ? { data: { requestId } } : {})
    }
  }

  if (isHttpClientError(error)) {
    const message = typeof error.statusMessage === "string" ? error.statusMessage : "Invalid request"
    return { statusCode: error.statusCode, statusMessage: message, message }
  }

  return {
    statusCode: 500,
    statusMessage: "Internal server error",
    message: "Internal server error",
    data: { requestId }
  }
}

const parseGraphQLApiUrl = (value: string) => {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new GraphQLProxyError(500, "GraphQL upstream is not configured")
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new GraphQLProxyError(500, "GraphQL upstream is not configured")
  }

  return url.toString()
}

const parseGraphQLRequestBody = (value: unknown): GraphQLRequestBody => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GraphQLProxyError(400, "Invalid GraphQL request body")
  }

  const { query, operationName, variables } = value as Record<string, unknown>
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new GraphQLProxyError(400, "Invalid GraphQL request body")
  }
  if (operationName !== undefined && operationName !== null && typeof operationName !== "string") {
    throw new GraphQLProxyError(400, "Invalid GraphQL request body")
  }
  if (variables !== undefined && variables !== null && (typeof variables !== "object" || Array.isArray(variables))) {
    throw new GraphQLProxyError(400, "Invalid GraphQL request body")
  }

  return {
    query,
    ...(operationName !== undefined ? { operationName: operationName as string | null } : {}),
    ...(variables !== undefined ? { variables: variables as Record<string, unknown> | null } : {})
  }
}

export const proxyGraphQLRequest = async ({
  graphqlApiUrl,
  body,
  authorization,
  userAgent,
  clientIp,
  requestId,
  requestIdForwardSecret,
  fetchRaw
}: ProxyGraphQLRequestOptions) => {
  if (!requestIdForwardSecret) throw new GraphQLProxyError(500, "Request tracing is not configured")

  const url = parseGraphQLApiUrl(graphqlApiUrl)
  const requestBody = parseGraphQLRequestBody(body)
  const headers: Record<string, string> = {
    accept: "application/graphql-response+json, application/json",
    "content-type": "application/json",
    "x-graphql-yoga-csrf": "bff",
    "x-request-id": requestId,
    "x-request-id-signature": createHmac("sha256", requestIdForwardSecret).update(requestId).digest("hex")
  }

  if (authorization) {
    headers.authorization = authorization
  }

  // Устройство и адрес записываются в сессию пользователя (ADR-0009 п. 1).
  if (userAgent) {
    headers["user-agent"] = userAgent
  }

  if (clientIp) {
    headers["x-forwarded-for"] = clientIp
  }

  try {
    const response = await fetchRaw(url, {
      method: "POST",
      body: requestBody,
      headers,
      ignoreResponseError: true
    })

    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "application/json",
      body: response._data
    }
  } catch {
    throw new GraphQLProxyError(502, "GraphQL upstream is unavailable")
  }
}
