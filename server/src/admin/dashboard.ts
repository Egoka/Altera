import type { Role } from "../generated/prisma"
import { ensureAuthenticated, ensurePermission } from "../exceptions/permissions"
import type { GraphQLContext } from "../prisma"

export interface AdminSummaryMetric {
  id: string
  value: number
}

export interface AdminSummaryCard {
  id: string
  href: string
  metrics: AdminSummaryMetric[]
  requestId: string | null
  status: "READY" | "ERROR"
}

export interface AdminSummary {
  role: Role
  cards: AdminSummaryCard[]
}

type ServiceRole = Extract<Role, "editor" | "moderator" | "analyst" | "admin" | "owner">

interface CardDefinition {
  id: string
  href: string
  read: (ctx: GraphQLContext, periodStart: Date) => Promise<AdminSummaryMetric[]>
}

const metric = (id: string, value: number): AdminSummaryMetric => ({ id, value })
const openAiStatuses = ["created", "started", "running"] as const
const reviewArticleStatuses = ["review", "in_review", "rework"] as const

const cards: Record<string, CardDefinition> = {
  editorial: {
    id: "editorial",
    href: "/admin/articles",
    read: async (ctx, periodStart) => {
      const [drafts, review, published] = await Promise.all([
        ctx.prisma.article.count({ where: { isEditorial: true, status: "draft" } }),
        ctx.prisma.article.count({ where: { isEditorial: true, status: { in: [...reviewArticleStatuses] } } }),
        ctx.prisma.article.count({ where: { isEditorial: true, publishedAt: { gte: periodStart } } })
      ])
      return [metric("drafts", drafts), metric("review", review), metric("published", published)]
    }
  },
  editorialProcesses: {
    id: "editorialProcesses",
    href: "/admin/ai",
    read: async (ctx) => {
      const [ai, mail] = await Promise.all([
        ctx.prisma.aiProcess.count({ where: { objectType: "Article", status: { in: [...openAiStatuses] } } }),
        ctx.prisma.mailMessage.count({ where: { objectType: "Article", status: { in: ["queued", "failed"] } } })
      ])
      return [metric("ai", ai), metric("mail", mail)]
    }
  },
  reviewQueue: {
    id: "reviewQueue",
    href: "/admin/review",
    read: async (ctx, periodStart) => {
      const [articles, unreadReplies, removed] = await Promise.all([
        ctx.prisma.article.count({ where: { status: { in: [...reviewArticleStatuses] } } }),
        ctx.prisma.reviewMessage.count({ where: { readAt: null } }),
        ctx.prisma.article.count({ where: { archivedAt: { gte: periodStart } } })
      ])
      return [metric("articles", articles), metric("unreadReplies", unreadReplies), metric("removed", removed)]
    }
  },
  profileChecks: {
    id: "profileChecks",
    href: "/admin/review?tab=profiles",
    read: async (ctx) => {
      const pending = await ctx.prisma.user.count({
        where: { OR: [{ nameCheckStatus: "pending" }, { avatarCheckStatus: "pending" }] }
      })
      return [metric("pending", pending)]
    }
  },
  growth: {
    id: "growth",
    href: "/admin/statistics",
    read: async (ctx, periodStart) => {
      const [registrations, activePlans] = await Promise.all([
        ctx.prisma.user.count({ where: { isServiceAccount: false, createdAt: { gte: periodStart } } }),
        ctx.prisma.planGrant.count({
          where: {
            startsAt: { lte: new Date() },
            revokedAt: null,
            OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }]
          }
        })
      ])
      return [metric("registrations", registrations), metric("activePlans", activePlans)]
    }
  },
  operationalQueue: {
    id: "operationalQueue",
    href: "/admin/jobs",
    read: async (ctx) => {
      const [review, ai, failedJobs] = await Promise.all([
        ctx.prisma.article.count({ where: { status: { in: [...reviewArticleStatuses] } } }),
        ctx.prisma.aiProcess.count({ where: { status: { in: [...openAiStatuses] } } }),
        ctx.prisma.job.count({ where: { status: { in: ["failed", "stuck"] } } })
      ])
      return [metric("review", review), metric("ai", ai), metric("failedJobs", failedJobs)]
    }
  },
  health: {
    id: "health",
    href: "/admin/errors",
    read: async (ctx) => {
      const [errors, failedMail] = await Promise.all([
        ctx.prisma.backendError.count({ where: { workStatus: { not: "resolved" } } }),
        ctx.prisma.mailMessage.count({ where: { status: { in: ["bounced", "failed"] } } })
      ])
      return [metric("errors", errors), metric("failedMail", failedMail)]
    }
  },
  ownership: {
    id: "ownership",
    href: "/admin/admins",
    read: async (ctx) => {
      const [owners, serviceAccounts] = await Promise.all([
        ctx.prisma.user.count({ where: { role: "owner", archivedAt: null } }),
        ctx.prisma.user.count({ where: { isServiceAccount: true, archivedAt: null } })
      ])
      return [metric("owners", owners), metric("serviceAccounts", serviceAccounts)]
    }
  }
}

const roleCards: Record<ServiceRole, readonly string[]> = {
  editor: ["editorial", "editorialProcesses"],
  moderator: ["reviewQueue", "profileChecks"],
  analyst: ["growth", "operationalQueue"],
  admin: ["growth", "operationalQueue", "health"],
  owner: ["growth", "operationalQueue", "health", "ownership"]
}

export async function getAdminSummary(ctx: GraphQLContext, periodDays: 7 | 30): Promise<AdminSummary> {
  ensurePermission(ctx.currentUser, "admin.enter", "admin.enter", ctx.requestId)
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  const role = user.role as ServiceRole
  const periodStart = new Date()
  periodStart.setUTCDate(periodStart.getUTCDate() - periodDays)

  ctx.logger.log({
    level: "info",
    event: "admin.enter",
    requestId: ctx.requestId,
    message: "Service account entered the admin dashboard",
    data: { role }
  })

  const results = await Promise.allSettled(
    roleCards[role].map(async (cardId) => {
      const definition = cards[cardId]
      if (!definition) throw new Error(`Unknown admin card: ${cardId}`)
      return { definition, metrics: await definition.read(ctx, periodStart) }
    })
  )

  const visibleCards = results.flatMap<AdminSummaryCard>((result, index) => {
    const cardId = roleCards[role][index]
    const definition = cardId ? cards[cardId] : undefined
    if (!definition) return []

    if (result.status === "rejected") {
      ctx.logger.log({
        level: "error",
        event: "backend.error",
        requestId: ctx.requestId,
        message: "Admin dashboard card failed",
        data: { cardId },
        error: result.reason
      })
      return [{ id: cardId, href: definition.href, metrics: [], requestId: ctx.requestId, status: "ERROR" }]
    }

    if (result.value.metrics.every(({ value }) => value === 0)) return []
    return [
      {
        id: cardId,
        href: definition.href,
        metrics: result.value.metrics,
        requestId: null,
        status: "READY"
      }
    ]
  })

  return { role, cards: visibleCards }
}
