import { extractImages, readDocument, toPlainText, type ContentDocument } from "@altera/content"
import jwt from "jsonwebtoken"
import { createApiError } from "../errors/graphql-error"
import type { Prisma } from "../generated/prisma"
import type { GraphQLContext } from "../prisma"
import { publicVariantSet } from "../media/variants"
import { publicSectionSelect, publicTagSelect, publicUserSelect } from "../visibility/article"

const PREVIEW_AUDIENCE = "article-preview"
const PREVIEW_ISSUER = "altera"
const PREVIEW_TTL = "15m"

const articlePageSelect = {
  id: true,
  locale: true,
  slug: true,
  title: true,
  dek: true,
  excerpt: true,
  featuredImage: true,
  body: true,
  status: true,
  rejected: true,
  publishedAt: true,
  reeditUntil: true,
  createdAt: true,
  updatedAt: true,
  article: {
    select: {
      id: true,
      status: true,
      sourceLocale: true,
      authorId: true,
      isEditorial: true,
      coverAssetId: true,
      firstPublishedAt: true,
      author: { select: publicUserSelect },
      section: { select: publicSectionSelect },
      format: { select: { id: true, name: true, nameEn: true, slug: true } },
      tags: { select: publicTagSelect },
      translations: {
        select: { id: true, locale: true, slug: true, status: true, rejected: true }
      }
    }
  }
} satisfies Prisma.ArticleTranslationSelect

const publicBodyAssetSelect = {
  id: true,
  processingStatus: true,
  mimeType: true,
  byteSize: true,
  width: true,
  height: true,
  alt: true,
  caption: true,
  attribution: true,
  license: true,
  licenseNote: true,
  variants: true,
  createdAt: true
} satisfies Prisma.MediaAssetSelect

type ArticlePageRow = Prisma.ArticleTranslationGetPayload<{ select: typeof articlePageSelect }>

export interface ArticlePageArgs {
  locale: "ru" | "en"
  sectionSlug: string
  slug: string
  preview?: string | null
}

interface PreviewClaims extends jwt.JwtPayload {
  type?: string
  sid?: string
  translationId?: string
}

function previewSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET
  if (!secret) throw new Error("JWT_ACCESS_SECRET must be defined in environment variables.")
  return secret
}

function canPreview(user: NonNullable<GraphQLContext["currentUser"]>, row: ArticlePageRow): boolean {
  if (user.role === "author" && row.article.authorId === user.id) return true
  if (user.role === "editor") return row.article.isEditorial
  return user.role === "moderator" || user.role === "admin" || user.role === "owner"
}

function issuePreviewToken(userId: string, sessionId: string, translationId: string): string {
  return jwt.sign({ type: PREVIEW_AUDIENCE, sid: sessionId, translationId }, previewSecret(), {
    algorithm: "HS256",
    audience: PREVIEW_AUDIENCE,
    issuer: PREVIEW_ISSUER,
    subject: userId,
    expiresIn: PREVIEW_TTL
  })
}

function previewTokenMatches(token: string, ctx: GraphQLContext, translationId: string): boolean {
  if (!ctx.currentUser || !ctx.sessionId) return false

  try {
    const claims = jwt.verify(token, previewSecret(), {
      algorithms: ["HS256"],
      audience: PREVIEW_AUDIENCE,
      issuer: PREVIEW_ISSUER
    }) as PreviewClaims
    return (
      claims.type === PREVIEW_AUDIENCE &&
      claims.sub === ctx.currentUser.id &&
      claims.sid === ctx.sessionId &&
      claims.translationId === translationId
    )
  } catch (error: unknown) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) return false
    throw error
  }
}

function notFound(ctx: GraphQLContext): never {
  throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "article" })
}

function publicPath(locale: "ru" | "en", sectionSlug: string, slug: string): string {
  const prefix = locale === "en" ? "/en" : ""
  return `${prefix}/${sectionSlug}/${slug}`
}

function readingTime(document: ContentDocument): number {
  const words = toPlainText(document).trim().split(/\s+/u).filter(Boolean).length
  return Math.max(1, Math.ceil(words / 200))
}

async function loadBodyAssets(ctx: GraphQLContext, document: ContentDocument) {
  const assetIds = [...new Set(extractImages(document).map((image) => image.assetId))]
  if (assetIds.length === 0) return []

  const assets = await ctx.prisma.mediaAsset.findMany({
    where: { id: { in: assetIds }, processingStatus: "ready", deletedAt: null },
    select: publicBodyAssetSelect
  })
  const byId = new Map(assets.map((asset) => [asset.id, asset]))

  return assetIds.flatMap((assetId) => {
    const asset = byId.get(assetId)
    if (!asset) return []
    return [
      {
        ...asset,
        variants: publicVariantSet(asset.variants, ctx.media.mediaBaseUrl),
        createdAt: asset.createdAt.toISOString()
      }
    ]
  })
}

async function findArticlePage(ctx: GraphQLContext, locale: "ru" | "en", slug: string) {
  return ctx.prisma.articleTranslation.findUnique({
    where: { locale_slug: { locale, slug } },
    select: articlePageSelect
  })
}

export async function createArticlePreviewToken(ctx: GraphQLContext, translationId: string): Promise<string> {
  if (!ctx.currentUser || !ctx.sessionId) {
    throw createApiError("UNAUTHENTICATED", { requestId: ctx.requestId })
  }

  const row = await ctx.prisma.articleTranslation.findUnique({
    where: { id: translationId },
    select: articlePageSelect
  })
  if (!row) notFound(ctx)
  if (!canPreview(ctx.currentUser, row)) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "article.preview" })
  }

  return issuePreviewToken(ctx.currentUser.id, ctx.sessionId, row.id)
}

export async function loadArticlePage(ctx: GraphQLContext, args: ArticlePageArgs) {
  const row = await findArticlePage(ctx, args.locale, args.slug)
  if (!row || row.article.section?.slug !== args.sectionSlug) notFound(ctx)

  const isPreview = Boolean(args.preview)
  if (isPreview) {
    if (!args.preview || !previewTokenMatches(args.preview, ctx, row.id)) notFound(ctx)
    if (!ctx.currentUser || !canPreview(ctx.currentUser, row)) {
      throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "article.preview" })
    }
  } else {
    const publiclyVisible = row.article.status !== "archived" && row.status === "published" && !row.rejected
    if (!publiclyVisible) {
      if (row.publishedAt) {
        throw createApiError("ARCHIVED", { requestId: ctx.requestId, entity: "article" })
      }
      notFound(ctx)
    }
  }

  const document = readDocument(row.body)
  const sibling = row.article.translations.find(
    (candidate) => candidate.id !== row.id && candidate.status === "published" && !candidate.rejected
  )

  return {
    id: row.article.id,
    translationId: row.id,
    locale: row.locale,
    title: row.title,
    slug: row.slug,
    dek: row.dek,
    excerpt: row.excerpt,
    featuredImage: row.featuredImage,
    body: document,
    bodyAssets: await loadBodyAssets(ctx, document),
    coverAssetId: row.article.coverAssetId,
    status: isPreview ? row.status : null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    firstPublishedAt: row.publishedAt?.toISOString() ?? row.article.firstPublishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    author: row.article.author,
    section: row.article.section,
    format: row.article.format,
    tags: row.article.tags,
    sibling: sibling
      ? {
          locale: sibling.locale,
          path: publicPath(sibling.locale, row.article.section.slug, sibling.slug)
        }
      : null,
    isTranslation: row.locale !== row.article.sourceLocale,
    readingTime: readingTime(document),
    preview: isPreview,
    reeditUntil:
      isPreview && ctx.currentUser?.id === row.article.authorId ? (row.reeditUntil?.toISOString() ?? null) : null
  }
}
