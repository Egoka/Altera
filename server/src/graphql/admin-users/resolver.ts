import {
  adminChangeEmail,
  archiveAccount,
  getAdminUser,
  listAdminUsers,
  restoreAccount,
  revokeUserSessions,
  type AdminUserCard,
  type AdminUserFilters,
  type AdminUserRow
} from "../../admin/users"
import type { AccountArchiveMode, AccountArchiveReasonCategory } from "../../generated/prisma"
import type { PaginationInput } from "../../utils/admin"
import type { GraphQLContext } from "../../prisma"

/**
 * Раздел «Пользователи» (`docs/spec/40-admin/users.md`). Права, маска адреса и запись чтения ПДн
 * решаются в `admin/users.ts`: резолвер только переводит даты в строки контракта.
 */

/** Даты плана переводит в строки контракта тот же вид, что у сводки кабинета (`AccountSubscription`). */
const presentPlan = (plan: AdminUserRow["plan"]) => ({
  state: plan.state,
  tier: plan.tier,
  until: plan.until?.toISOString() ?? null,
  endedAt: plan.endedAt?.toISOString() ?? null,
  queue: plan.queue.map((period) => ({
    tier: period.tier,
    startsAt: period.startsAt.toISOString(),
    endsAt: period.endsAt?.toISOString() ?? null
  }))
})

const presentRow = (row: AdminUserRow) => ({
  ...row,
  plan: presentPlan(row.plan),
  createdAt: row.createdAt.toISOString(),
  lastActiveAt: row.lastActiveAt?.toISOString() ?? null
})

const presentCard = (card: AdminUserCard) => ({
  ...presentRow(card),
  archivedAt: card.archivedAt?.toISOString() ?? null,
  baseAuthorship: {
    enabled: card.baseAuthorship.enabled,
    enabledAt: card.baseAuthorship.enabledAt?.toISOString() ?? null
  },
  articles: card.articles.map((article) => ({
    ...article,
    createdAt: article.createdAt.toISOString(),
    publishedAt: article.publishedAt?.toISOString() ?? null,
    archivedAt: article.archivedAt?.toISOString() ?? null
  })),
  consents: card.consents.map((consent) => ({ ...consent, acceptedAt: consent.acceptedAt.toISOString() })),
  sessions:
    card.sessions?.map((session) => ({
      ...session,
      createdAt: session.createdAt.toISOString(),
      lastActiveAt: session.lastActiveAt.toISOString()
    })) ?? null,
  appeal: card.appeal
    ? {
        ...card.appeal,
        submittedAt: card.appeal.submittedAt.toISOString(),
        decidedAt: card.appeal.decidedAt?.toISOString() ?? null
      }
    : null
})

export default {
  Query: {
    adminUsers: async (
      _parent: unknown,
      args: { filters?: AdminUserFilters | null; pagination?: PaginationInput | null },
      ctx: GraphQLContext
    ) => {
      const list = await listAdminUsers(ctx, args)
      return { ...list, items: list.items.map(presentRow) }
    },
    adminUser: async (_parent: unknown, args: { id: string }, ctx: GraphQLContext) => {
      const card = await getAdminUser(ctx, args.id)
      return card ? presentCard(card) : null
    }
  },
  Mutation: {
    archiveAccount: async (
      _parent: unknown,
      args: {
        id: string
        reasonCategory: AccountArchiveReasonCategory
        internalReason: string
        publicMessage?: string | null
        mode?: AccountArchiveMode | null
      },
      ctx: GraphQLContext
    ) => presentCard(await archiveAccount(ctx, args)),
    restoreAccount: async (_parent: unknown, args: { id: string; reason: string }, ctx: GraphQLContext) =>
      presentCard(await restoreAccount(ctx, args)),
    revokeUserSessions: async (_parent: unknown, args: { id: string }, ctx: GraphQLContext) =>
      revokeUserSessions(ctx, args),
    adminChangeEmail: async (
      _parent: unknown,
      args: { id: string; newEmail: string; reason: string },
      ctx: GraphQLContext
    ) => {
      const result = await adminChangeEmail(ctx, args)
      return { emailMasked: result.emailMasked, changedAt: result.changedAt.toISOString() }
    }
  }
}
