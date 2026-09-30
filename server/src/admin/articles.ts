import type { Prisma, Role } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import { ensureAuthenticated } from "../exceptions/permissions"
import type { GraphQLContext } from "../prisma"
import { calculatePagination, validatePagination, type PaginationInput } from "../utils/admin"

const READER_ROLES = new Set<Role>(["editor", "moderator", "admin", "owner"])
const REVIEW_STATUSES = ["ai_check", "review", "in_review", "rework"] as const

const articleSelect = {
  id: true,
  slug: true,
  status: true,
  sourceLocale: true,
  isEditorial: true,
  firstPublishedAt: true,
  archivedAt: true,
  archivedByActorId: true,
  archivedByRole: true,
  archiveReason: true,
  author: { select: { id: true, name: true, handle: true } },
  section: { select: { id: true, name: true, slug: true } },
  format: { select: { id: true, name: true, slug: true } },
  tags: { select: { id: true, name: true, slug: true } },
  coverAsset: { select: { id: true, alt: true, variants: true } },
  translations: {
    select: { id: true, locale: true, title: true, slug: true, status: true, rejected: true },
    orderBy: [{ locale: "asc" as const }, { id: "asc" as const }]
  }
} satisfies Prisma.ArticleSelect

const rowInclude = { article: { select: articleSelect } } satisfies Prisma.ArticleTranslationInclude

const detailInclude = {
  ...rowInclude,
  revisions: {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    include: { createdBy: { select: { id: true, name: true, handle: true, role: true } } }
  },
  reviewMessages: {
    where: { parentId: null },
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    include: { replies: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] } }
  }
} satisfies Prisma.ArticleTranslationInclude

type RowRecord = Prisma.ArticleTranslationGetPayload<{ include: typeof rowInclude }>
type DetailRecord = Prisma.ArticleTranslationGetPayload<{ include: typeof detailInclude }>
type Reader = NonNullable<GraphQLContext["currentUser"]>

export type AdminArticleTab = "all" | "draft" | "review" | "published" | "rejected" | "archived"
export type AdminArticleSort = "updated" | "published" | "title" | "reads"

export interface AdminArticleFilters {
  status?: AdminArticleTab | null
  locale?: "ru" | "en" | null
  sectionId?: string | null
  formatId?: string | null
  tagId?: string | null
  author?: string | null
  archiveRole?: Role | null
  publishedFrom?: string | null
  publishedTo?: string | null
  search?: string | null
}

export interface AdminArticlesInput {
  filters?: AdminArticleFilters | null
  pagination?: PaginationInput | null
  sort?: AdminArticleSort | null
}

function ensureReader(ctx: GraphQLContext): Reader {
  const actor = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  if (actor.archivedAt || !READER_ROLES.has(actor.role)) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "admin.articles.read" })
  }
  return actor
}

function validationError(ctx: GraphQLContext, field: string, rule: string): never {
  throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field, rule })
}

function parseDate(ctx: GraphQLContext, field: string, value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) validationError(ctx, field, "iso-date")
  return date
}

function statusWhere(status: AdminArticleTab | null | undefined): Prisma.ArticleTranslationWhereInput {
  if (status === "archived") return { article: { status: "archived" } }
  const activeArticle = { status: { not: "archived" as const } }
  if (status === "rejected") return { rejected: true, article: activeArticle }
  if (status === "review") return { rejected: false, status: { in: [...REVIEW_STATUSES] }, article: activeArticle }
  if (status && status !== "all") return { rejected: false, status, article: activeArticle }
  return { rejected: false, article: activeArticle }
}

function buildWhere(
  ctx: GraphQLContext,
  actor: Reader,
  filters: AdminArticleFilters | null | undefined
): Prisma.ArticleTranslationWhereInput {
  const search = filters?.search?.trim() ?? ""
  if (search && search.length < 3) validationError(ctx, "filters.search", "minLength:3")
  const author = filters?.author?.trim() ?? ""
  const publishedFrom = parseDate(ctx, "filters.publishedFrom", filters?.publishedFrom)
  const publishedTo = parseDate(ctx, "filters.publishedTo", filters?.publishedTo)
  if (publishedFrom && publishedTo && publishedFrom > publishedTo) {
    validationError(ctx, "filters.publishedAt", "from-before-to")
  }

  const status = statusWhere(filters?.status)
  const statusArticle =
    "article" in status && status.article && typeof status.article === "object" ? status.article : {}
  const article: Prisma.ArticleWhereInput = {
    ...statusArticle,
    ...(actor.role === "editor" ? { isEditorial: true } : {}),
    ...(filters?.sectionId ? { sectionId: filters.sectionId } : {}),
    ...(filters?.formatId ? { formatId: filters.formatId } : {}),
    ...(filters?.tagId ? { tags: { some: { id: filters.tagId } } } : {}),
    ...(filters?.archiveRole ? { archivedByRole: filters.archiveRole } : {}),
    ...(author
      ? {
          OR: [
            { author: { handle: { contains: author, mode: "insensitive" } } },
            ...(author.toLocaleLowerCase() === "журнал" || author.toLocaleLowerCase() === "editorial"
              ? [{ isEditorial: true }]
              : [])
          ]
        }
      : {})
  }

  return {
    ...status,
    article,
    ...(filters?.locale ? { locale: filters.locale } : {}),
    ...(publishedFrom || publishedTo
      ? {
          publishedAt: {
            ...(publishedFrom ? { gte: publishedFrom } : {}),
            ...(publishedTo ? { lte: publishedTo } : {})
          }
        }
      : {}),
    ...(search
      ? {
          AND: [
            {
              OR: [
                { title: { contains: search, mode: "insensitive" } },
                { slug: { contains: search, mode: "insensitive" } }
              ]
            }
          ]
        }
      : {})
  }
}

function effectiveStatus(record: RowRecord): string {
  if (record.article.status === "archived") return "archived"
  if (record.rejected) return "rejected"
  return record.status
}

function toRow(record: RowRecord) {
  return {
    id: record.id,
    articleId: record.articleId,
    title: record.title,
    slug: record.slug,
    locale: record.locale,
    status: effectiveStatus(record),
    rejected: record.rejected,
    readCount: record.readCount,
    publishedAt: record.publishedAt,
    updatedAt: record.updatedAt,
    editorial: record.article.isEditorial,
    author: record.article.author,
    section: record.article.section,
    format: record.article.format,
    tags: record.article.tags,
    archive: record.article.archivedAt
      ? {
          at: record.article.archivedAt,
          actorId: record.article.archivedByActorId,
          role: record.article.archivedByRole,
          reason: record.article.archiveReason
        }
      : null
  }
}

function orderBy(sort: AdminArticleSort | null | undefined): Prisma.ArticleTranslationOrderByWithRelationInput[] {
  if (sort === "published") return [{ publishedAt: "desc" }, { id: "asc" }]
  if (sort === "title") return [{ title: "asc" }, { id: "asc" }]
  if (sort === "reads") return [{ readCount: "desc" }, { id: "asc" }]
  return [{ updatedAt: "desc" }, { id: "asc" }]
}

export async function listAdminArticles(ctx: GraphQLContext, input: AdminArticlesInput = {}) {
  const actor = ensureReader(ctx)
  const pagination = input.pagination ?? { page: 1, limit: 20 }
  validatePagination(pagination, ctx.requestId)
  const where = buildWhere(ctx, actor, input.filters)
  const total = await ctx.prisma.articleTranslation.count({ where })
  const page = calculatePagination(pagination.page, pagination.limit, total)
  const items = await ctx.prisma.articleTranslation.findMany({
    where,
    include: rowInclude,
    orderBy: orderBy(input.sort),
    skip: page.skip,
    take: page.take
  })
  return { items: items.map(toRow), pagination: page.pagination }
}

export async function getAdminArticleFilterOptions(ctx: GraphQLContext) {
  ensureReader(ctx)
  const select = { id: true, name: true, slug: true } as const
  const [sections, formats, tags] = await Promise.all([
    ctx.prisma.section.findMany({ where: {}, select, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    ctx.prisma.format.findMany({ where: {}, select, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    ctx.prisma.tag.findMany({ where: {}, select, orderBy: [{ name: "asc" }, { id: "asc" }] })
  ])
  return { sections, formats, tags }
}

export async function getAdminArticle(ctx: GraphQLContext, id: string) {
  const actor = ensureReader(ctx)
  const record = await ctx.prisma.articleTranslation.findUnique({ where: { id }, include: detailInclude })
  if (!record || (actor.role === "editor" && !record.article.isEditorial)) {
    throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "translation" })
  }
  const detail = record as DetailRecord
  return {
    ...toRow(detail),
    dek: detail.dek,
    excerpt: detail.excerpt,
    body: detail.body,
    cover: detail.article.coverAsset,
    revisions: detail.revisions.map((revision) => ({
      id: revision.id,
      title: revision.title,
      body: revision.body,
      kind: revision.kind,
      note: revision.note,
      size: JSON.stringify(revision.body).length,
      createdAt: revision.createdAt,
      author: revision.createdBy
    })),
    decisions: detail.reviewMessages,
    siblings: detail.article.translations.filter(({ id: siblingId }) => siblingId !== detail.id)
  }
}
