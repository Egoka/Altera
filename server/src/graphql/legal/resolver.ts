import type { GraphQLContext } from "../../prisma"
import type { Locale } from "../../generated/prisma"
import { buildCacheKey, CACHE_TTL_SECONDS } from "../../cache"
import { readThroughPublicCache } from "../../cache/read-through"
import { createApiError } from "../../errors/graphql-error"
import { ensureAuthenticated } from "../../exceptions/permissions"
import { readConsentStates } from "../../auth/legal"
import {
  legalCacheTag,
  LegalVersionNotFound,
  readPublicLegalText,
  type LegalDocumentView,
  type PublicLegalKind
} from "../../legal/texts"

export default {
  Query: {
    legalText: async (
      _parent: unknown,
      args: { kind: PublicLegalKind; locale: Locale; version?: number | null },
      ctx: GraphQLContext
    ): Promise<LegalDocumentView | null> => {
      const version = args.version ?? null
      try {
        // Документ публичный и одинаков для всех (ADR-0019): кешируется вместе с ответом «не
        // опубликован», отказ «версия не найдена» не кешируется.
        return await readThroughPublicCache(
          {
            cache: ctx.cache,
            key: buildCacheKey("query.legalText", { kind: args.kind, locale: args.locale, version }),
            tags: [legalCacheTag(args.kind)],
            ttlSeconds: CACHE_TTL_SECONDS.publicList
          },
          () => readPublicLegalText(ctx.prisma, { kind: args.kind, locale: args.locale, version })
        )
      } catch (error: unknown) {
        if (error instanceof LegalVersionNotFound) {
          throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "legalText" })
        }
        throw error
      }
    },

    staticText: async (
      _parent: unknown,
      args: { kind: "about"; locale: Locale },
      ctx: GraphQLContext
    ): Promise<LegalDocumentView<"about"> | null> =>
      // Текст «О проекте» публичный, как юридические; публикация в `/admin/legal` сбрасывает тег вида.
      readThroughPublicCache(
        {
          cache: ctx.cache,
          key: buildCacheKey("query.staticText", { kind: args.kind, locale: args.locale }),
          tags: [legalCacheTag(args.kind)],
          ttlSeconds: CACHE_TTL_SECONDS.publicList
        },
        () => readPublicLegalText(ctx.prisma, { kind: args.kind, locale: args.locale })
      )
  },
  AccountUser: {
    consents: async (parent: { id: string }, _args: unknown, ctx: GraphQLContext) => {
      const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
      // Архивированный аккаунт читает юридические тексты как гость (`legal-terms.md` §8).
      if (parent.id !== user.id || user.archivedAt) {
        throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "consent.list" })
      }

      const states = await readConsentStates(ctx.prisma, user.id, user.locale)
      return states.map((state) => ({
        ...state,
        acceptedAt: state.acceptedAt?.toISOString() ?? null
      }))
    }
  }
}
