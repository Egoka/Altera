import {
  getAdminMail,
  getMailSummary,
  listAdminMails,
  resendMail,
  resendMails,
  type AdminMailFilters,
  type AdminMailItem
} from "../../admin/mail"
import type { GraphQLContext } from "../../prisma"
import type { PaginationInput } from "../../utils/admin"

type AdminSummaryPeriod = "DAYS_7" | "DAYS_30"

interface AdminMailsArgs {
  filters?: AdminMailFilters | null
  pagination?: PaginationInput | null
}

function presentMail(mail: AdminMailItem) {
  return {
    ...mail,
    queuedAt: mail.queuedAt.toISOString(),
    sentAt: mail.sentAt?.toISOString() ?? null,
    createdAt: mail.createdAt.toISOString(),
    deliveryEvents: mail.deliveryEvents.map((event) => ({
      ...event,
      occurredAt: event.occurredAt.toISOString()
    }))
  }
}

export default {
  Query: {
    adminMails: async (_parent: unknown, args: AdminMailsArgs, ctx: GraphQLContext) => {
      const list = await listAdminMails(ctx, args)
      return { ...list, items: list.items.map(presentMail) }
    },
    adminMail: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const mail = await getAdminMail(ctx, id)
      return mail ? presentMail(mail) : null
    },
    mailSummary: (_parent: unknown, { period }: { period: AdminSummaryPeriod }, ctx: GraphQLContext) =>
      getMailSummary(ctx, period === "DAYS_30" ? 30 : 7)
  },
  Mutation: {
    resendMail: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      presentMail(await resendMail(ctx, id)),
    resendMails: (_parent: unknown, { ids }: { ids: string[] }, ctx: GraphQLContext) => resendMails(ctx, ids)
  }
}
