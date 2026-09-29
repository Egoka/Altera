import { articleCoverView } from "../../article/cover"
import type { GraphQLContext } from "../../prisma"
import {
  authoringTaxonomy,
  getEditorTranslation,
  listRevisions,
  reeditTranslation,
  restoreRevision,
  saveTranslation,
  setSlug,
  setTaxonomy,
  submitTranslation,
  withdrawTranslation,
  type EditorTranslationView,
  type SaveTranslationPatch
} from "../../translation/editor"

/**
 * Обвязка редактора (`docs/spec/30-account/author/article-edit.md`). Решения живут в
 * `src/translation/editor.ts`: резолвер только переводит выборку Prisma в поля схемы.
 */

function toEditorTranslation(view: EditorTranslationView) {
  return {
    id: view.id,
    locale: view.locale,
    status: view.status,
    rejected: view.rejected,
    title: view.title,
    lead: view.dek,
    body: view.body,
    seo: {
      description: view.excerpt,
      slug: view.slug,
      // Адрес закрыт после первой публикации материала: публичная ссылка не переезжает (ADR-0004).
      slugLocked: Boolean(view.publishedAt || view.article.firstPublishedAt)
    },
    article: {
      id: view.article.id,
      coverAssetId: view.article.coverAssetId,
      section: view.article.section,
      format: view.article.format,
      tags: view.article.tags,
      translations: view.article.translations
    },
    currentRevisionId: view.currentRevisionId,
    reeditUntil: view.reeditUntil?.toISOString() ?? null,
    readOnlyReason: view.readOnlyReason,
    updatedAt: view.updatedAt.toISOString()
  }
}

export default {
  Query: {
    translation: async (_parent: unknown, args: { id: string }, ctx: GraphQLContext) =>
      toEditorTranslation(await getEditorTranslation(ctx, args.id)),

    revisions: (
      _parent: unknown,
      args: { translationId: string; cursor?: string | null; limit?: number | null },
      ctx: GraphQLContext
    ) => listRevisions(ctx, args.translationId, args.cursor ?? null, args.limit ?? 20),

    authoringTaxonomy: (_parent: unknown, _args: unknown, ctx: GraphQLContext) => authoringTaxonomy(ctx)
  },

  Mutation: {
    saveTranslation: (
      _parent: unknown,
      args: { id: string; baseRevisionId: string; patch: SaveTranslationPatch; kind: "autosave" | "manual" },
      ctx: GraphQLContext
    ) => saveTranslation(ctx, { id: args.id, baseRevisionId: args.baseRevisionId, patch: args.patch, kind: args.kind }),

    submitTranslation: async (_parent: unknown, args: { id: string }, ctx: GraphQLContext) =>
      toEditorTranslation(await submitTranslation(ctx, args.id)),

    withdrawTranslation: async (_parent: unknown, args: { id: string }, ctx: GraphQLContext) =>
      toEditorTranslation(await withdrawTranslation(ctx, args.id)),

    reeditTranslation: async (_parent: unknown, args: { id: string }, ctx: GraphQLContext) =>
      toEditorTranslation(await reeditTranslation(ctx, args.id)),

    restoreRevision: (_parent: unknown, args: { translationId: string; revisionId: string }, ctx: GraphQLContext) =>
      restoreRevision(ctx, args.translationId, args.revisionId),

    setTaxonomy: (
      _parent: unknown,
      args: { articleId: string; sectionId?: string | null; formatId?: string | null; tagIds: string[] },
      ctx: GraphQLContext
    ) =>
      setTaxonomy(ctx, {
        articleId: args.articleId,
        sectionId: args.sectionId ?? null,
        formatId: args.formatId ?? null,
        tagIds: args.tagIds
      }),

    setSlug: (_parent: unknown, args: { translationId: string; slug: string }, ctx: GraphQLContext) =>
      setSlug(ctx, args.translationId, args.slug)
  },

  EditorArticle: {
    // Адреса вариантов собираются из ключей при чтении, поэтому обложка читается отдельным полем.
    cover: (parent: { coverAssetId?: string | null }, _args: unknown, ctx: GraphQLContext) =>
      articleCoverView(ctx, parent.coverAssetId ?? null)
  }
}
