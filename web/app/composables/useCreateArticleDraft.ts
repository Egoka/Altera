import { CREATE_ARTICLE } from "~/query"
import { useGraphQL } from "./useGraphQL"

export const createArticleDraftAndOpenEditor = async (sectionId?: string) => {
  const response = await useGraphQL(CREATE_ARTICLE, {
    input: sectionId ? { sectionId } : {}
  })
  const articleId = response.data?.createArticle.id

  if (!articleId) {
    throw createError({
      statusCode: 500,
      statusMessage: response.errors?.[0]?.message ?? "Draft creation failed"
    })
  }

  return navigateTo(`/me/articles/${articleId}/edit`, { redirectCode: 302, replace: true })
}
