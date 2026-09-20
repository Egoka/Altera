interface GraphQLErrorLike {
  extensions?: Readonly<Record<string, unknown>>
}

interface BookmarkEnvelope {
  data?: { myBookmark?: { bookmarked: boolean } | null } | null
  errors?: readonly GraphQLErrorLike[]
}

/// Состояние кнопки закладки на материале решает сервер: сессии в вебе пока нет,
/// поэтому гость и служебная роль различаются по коду ошибки (`20-public/article.md` §7).
export type ArticleBookmarkState = { kind: "owner"; bookmarked: boolean } | { kind: "guest" } | { kind: "hidden" }

function code(error: GraphQLErrorLike | undefined): string | undefined {
  const value = error?.extensions?.code
  return typeof value === "string" ? value : undefined
}

export function getArticleBookmarkState(envelope: BookmarkEnvelope): ArticleBookmarkState {
  const bookmark = envelope.data?.myBookmark
  if (bookmark) return { kind: "owner", bookmarked: bookmark.bookmarked }

  const codes = new Set((envelope.errors ?? []).map(code))
  if (codes.has("UNAUTHENTICATED")) return { kind: "guest" }

  // Служебной роли кнопка не показывается вовсе (журнал #58); прочие сбои — тоже без кнопки.
  return { kind: "hidden" }
}
