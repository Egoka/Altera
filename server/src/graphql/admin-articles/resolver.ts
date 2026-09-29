import { getAdminArticle, getAdminArticleFilterOptions, listAdminArticles } from "../../admin/articles"
import type { GraphQLContext } from "../../prisma"

const iso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null

const presentRow = <T extends { publishedAt: Date | null; updatedAt: Date; archive: { at: Date } | null }>(row: T) => ({
  ...row,
  publishedAt: iso(row.publishedAt),
  updatedAt: row.updatedAt.toISOString(),
  archive: row.archive ? { ...row.archive, at: row.archive.at.toISOString() } : null
})

const presentDetail = (record: Awaited<ReturnType<typeof getAdminArticle>>) => ({
  ...presentRow(record),
  revisions: record.revisions.map((revision) => ({
    ...revision,
    createdAt: revision.createdAt.toISOString()
  })),
  decisions: record.decisions.map((decision) => ({
    ...decision,
    createdAt: decision.createdAt.toISOString(),
    replies: decision.replies.map((reply) => ({ ...reply, createdAt: reply.createdAt.toISOString() }))
  }))
})

const resolver = {
  Query: {
    adminArticles: async (_parent: unknown, input: Parameters<typeof listAdminArticles>[1], ctx: GraphQLContext) => {
      const page = await listAdminArticles(ctx, input)
      return { ...page, items: page.items.map(presentRow) }
    },
    adminArticle: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      presentDetail(await getAdminArticle(ctx, id)),
    adminArticleFilterOptions: async (_parent: unknown, _input: unknown, ctx: GraphQLContext) =>
      getAdminArticleFilterOptions(ctx)
  }
}

export default resolver
