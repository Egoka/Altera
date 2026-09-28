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
  const created = response.data?.createArticle

  if (!created) {
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

  // Адрес редактора называет языковую версию, а не материал (`article-edit.md` §3,
  // `00-registries/routes.md` #36): у материала их может быть две.
  return navigateTo(`/me/articles/${created.translations[0]!.id}/edit`, { redirectCode: 302, replace: true })
}
