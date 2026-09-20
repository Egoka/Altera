import type { GraphQLContext } from "../../prisma"
import { buildCacheKey, CACHE_TTL_SECONDS } from "../../cache"
import { readThroughPublicCache } from "../../cache/read-through"
import { createApiError } from "../../errors/graphql-error"
import { publicArticleWhere } from "../../visibility/article"

type AuthorGrade = "standard" | "pro"

interface AuthorLink {
  kind: string
  url: string
}

export interface AuthorProfile {
  id: string
  handle: string
  name: string
  bio: string | null
  avatar: string | null
  links: AuthorLink[]
  grade: AuthorGrade
  publishedCount: number
  firstPublishedAt: string | null
  redirect: string | null
}

/**
 * Хэндл из адреса: регистр не учитывается (`author.md` §3), поэтому поиск идёт по нижнему
 * регистру, а на канонический адрес страница уходит 301. Пустой аргумент — неверный адрес,
 * а не «показать кого-нибудь».
 */
export const normalizeHandle = (handle: string, requestId: string): string => {
  const value = handle.trim().toLowerCase()
  if (!value) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "handle", rule: "required" })
  }
  return value
}

/** Адреса соцсетей приходят из профиля автора, поэтому наружу выходят только `http` и `https`. */
const SAFE_LINK_SCHEMES = new Set(["http:", "https:"])

/**
 * Ссылки профиля: пары «вид → адрес» из `socialLinks`. Пустые значения, чужие схемы и
 * неразбираемые адреса отбрасываются — в разметку страницы не должен попасть адрес со
 * скриптом, а показывать читателю битую ссылку незачем.
 */
export const toAuthorLinks = (socialLinks: unknown): AuthorLink[] => {
  if (typeof socialLinks !== "object" || socialLinks === null || Array.isArray(socialLinks)) return []

  const links: AuthorLink[] = []
  for (const [kind, value] of Object.entries(socialLinks as Record<string, unknown>)) {
    if (typeof value !== "string" || !value.trim()) continue
    let parsed: URL
    try {
      parsed = new URL(value.trim())
    } catch {
      continue
    }
    if (!SAFE_LINK_SCHEMES.has(parsed.protocol)) continue
    links.push({ kind, url: parsed.toString() })
  }
  return links
}

/** Бейдж уровня автора; плана, срока и чисел рейтинга публичный ответ не содержит (ADR-0018). */
const gradeOf = (planTier: string): AuthorGrade => (planTier === "pro" ? "pro" : "standard")

const authorSelect = {
  id: true,
  handle: true,
  name: true,
  bio: true,
  photoUrl: true,
  socialLinks: true,
  planTier: true,
  archivedAt: true
} as const

/**
 * Аккаунт под адресом страницы автора вместе с переездом адреса.
 *
 * Прежний хэндл ведёт на нынешний (`routes.md` #7): реестр хэндлов не чистится, поэтому
 * запись истории без владельца (аккаунт удалён) — это 404, а не пустая страница.
 * Архивированный аккаунт отвечает 410 и до профиля не доходит (журнал §28.2).
 */
export const findPageAuthor = async (ctx: GraphQLContext, handle: string) => {
  const user = await ctx.prisma.user.findUnique({ where: { handle }, select: authorSelect })
  if (user) {
    if (user.archivedAt) throw createApiError("ARCHIVED", { requestId: ctx.requestId, entity: "author" })
    return { user, redirect: null as string | null }
  }

  const history = await ctx.prisma.handleHistory.findUnique({
    where: { handle },
    select: { user: { select: authorSelect } }
  })
  const owner = history?.user
  if (!owner) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "author" })
  if (owner.archivedAt) throw createApiError("ARCHIVED", { requestId: ctx.requestId, entity: "author" })

  return { user: owner, redirect: owner.handle }
}

export default {
  Query: {
    /**
     * Профиль автора публичной страницы (`author.md` §4). Страница есть только у аккаунта
     * хотя бы с одной опубликованной версией (§1) — счёт и дата первой публикации идут по
     * всем языкам, потому что аргумента локали у запроса нет, а лента языка живёт в `feed`.
     */
    author: async (_parent: unknown, args: { handle: string }, ctx: GraphQLContext): Promise<AuthorProfile> => {
      const handle = normalizeHandle(args.handle, ctx.requestId)

      // Ответ одинаков для всех и от сессии не зависит (ADR-0019); тег `author:{handle}`
      // публикация и архивирование материала уже сбрасывают (`cache/key.ts`).
      return readThroughPublicCache(
        {
          cache: ctx.cache,
          key: buildCacheKey("query.author", { handle }),
          tags: [`author:${handle}`],
          ttlSeconds: CACHE_TTL_SECONDS.publicList
        },
        async () => {
          const { user, redirect } = await findPageAuthor(ctx, handle)
          const where = publicArticleWhere({ authorId: user.id })
          const [publishedCount, firstPublished] = await Promise.all([
            ctx.prisma.article.count({ where }),
            ctx.prisma.article.findFirst({
              where: { ...where, firstPublishedAt: { not: null } },
              orderBy: { firstPublishedAt: "asc" },
              select: { firstPublishedAt: true }
            })
          ])

          // Аккаунт без публикаций публичной страницы не имеет (§1 `[ДОПУЩЕНИЕ]`, §3).
          if (publishedCount === 0) {
            throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "author" })
          }

          return {
            id: user.id,
            handle: user.handle,
            name: user.name,
            bio: user.bio,
            avatar: user.photoUrl,
            links: toAuthorLinks(user.socialLinks),
            grade: gradeOf(user.planTier),
            publishedCount,
            firstPublishedAt: firstPublished?.firstPublishedAt?.toISOString() ?? null,
            redirect
          }
        }
      )
    }
  }
}
