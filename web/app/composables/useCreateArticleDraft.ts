import { CREATE_ARTICLE } from "~/query"
import { useGraphQL } from "./useGraphQL"

// Ожидаемые отказы API не должны превращаться в страницу 500 (article-new.md §3).
const errorStatusCodes: Readonly<Record<string, number>> = {
  FORBIDDEN: 403,
  PLAN_LIMIT: 403
}

export const createArticleDraftAndOpenEditor = async (sectionId?: string) => {
  const response = await useGraphQL(CREATE_ARTICLE, {
    input: sectionId ? { sectionId } : {}
  })
  const articleId = response.data?.createArticle.id

  if (!articleId) {
    const error = response.errors?.[0]
    const code = typeof error?.extensions?.code === "string" ? error.extensions.code : undefined

    if (code === "UNAUTHENTICATED") {
      const target = sectionId ? `/me/articles/new?section=${encodeURIComponent(sectionId)}` : "/me/articles/new"
      return navigateTo(`/login?next=${encodeURIComponent(target)}`, { redirectCode: 302, replace: true })
    }

    throw createError({
      statusCode: (code && errorStatusCodes[code]) || 500,
      statusMessage: error?.message ?? "Draft creation failed"
    })
  }

  return navigateTo(`/me/articles/${articleId}/edit`, { redirectCode: 302, replace: true })
}
