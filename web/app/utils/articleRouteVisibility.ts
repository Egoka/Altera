interface GraphQLErrorLike {
  extensions?: Readonly<Record<string, unknown>>
}

interface ArticleEnvelope<TArticle> {
  data?: { article?: TArticle | null } | null
  errors?: readonly GraphQLErrorLike[]
}

export type ArticleRouteState<TArticle> =
  | { kind: "visible"; article: TArticle }
  | { kind: "gone"; statusCode: 410 }
  | { kind: "error"; statusCode: 404 | 500; code: string; requestId: string | undefined }

function extension(error: GraphQLErrorLike | undefined, key: string): string | undefined {
  const value = error?.extensions?.[key]
  return typeof value === "string" ? value : undefined
}

export function getArticleRouteState<TArticle>(envelope: ArticleEnvelope<TArticle>): ArticleRouteState<TArticle> {
  const article = envelope.data?.article
  if (article) return { kind: "visible", article }

  const archived = envelope.errors?.find((error) => extension(error, "code") === "ARCHIVED")
  if (archived) return { kind: "gone", statusCode: 410 }

  const notFound = envelope.errors?.find((error) => extension(error, "code") === "NOT_FOUND")
  if (notFound) {
    return {
      kind: "error",
      statusCode: 404,
      code: "NOT_FOUND",
      requestId: extension(notFound, "requestId")
    }
  }

  const error = envelope.errors?.[0]
  return {
    kind: "error",
    statusCode: 500,
    code: extension(error, "code") ?? "INTERNAL_ERROR",
    requestId: extension(error, "requestId")
  }
}
