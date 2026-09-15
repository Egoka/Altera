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
  fetchRaw: FetchRaw
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
  fetchRaw
}: ProxyGraphQLRequestOptions) => {
  const url = parseGraphQLApiUrl(graphqlApiUrl)
  const requestBody = parseGraphQLRequestBody(body)
  const headers: Record<string, string> = {
    accept: "application/graphql-response+json, application/json",
    "content-type": "application/json",
    "x-graphql-yoga-csrf": "bff"
  }

  if (authorization) {
    headers.authorization = authorization
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
