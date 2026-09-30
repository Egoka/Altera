import { randomBytes } from "node:crypto"
import { addHours } from "date-fns"
import type {
  AccountAppealStatus,
  AccountArchiveReasonCategory,
  Locale,
  PlanTier,
  Prisma,
  Role
} from "../generated/prisma"
import { authorCacheTag } from "../cache/key"
import { hashOpaqueToken } from "../auth/token-hash"
import { createApiError } from "../errors/graphql-error"
import { ensureAuthenticated, ensureRole } from "../exceptions/permissions"
import { ACCOUNT_APPEAL_DECISION_TEMPLATE, createAccountAppealDecisionMail } from "../mail/messages"
import type { GraphQLContext } from "../prisma"

export type AccountAppealDecision = "restore" | "confirm_block"
export type PublicAccountAppealStatus = "none" | AccountAppealStatus

export interface PublicAccountAppealView {
  locale: Locale
  archivedAt: Date
  reasonCategory: AccountArchiveReasonCategory
  explanation: string
  staffMessage: string | null
  plan: { tier: PlanTier; until: Date } | null
  appeal: {
    id: string | null
    status: PublicAccountAppealStatus
    submittedAt: Date | null
    decidedAt: Date | null
  }
  canSubmit: boolean
}

const explanations: Record<Locale, Record<AccountArchiveReasonCategory, string>> = {
  ru: {
    rules_violation: "Материалы или действия аккаунта нарушили правила публикации.",
    spam_and_manipulation: "Массовая рассылка, искусственное продвижение и другие способы накрутки.",
    law_or_rights_violation: "Обнаружено нарушение закона, авторских или иных прав.",
    security_threat: "Ограничение защищает аккаунт и сервис от взлома, чужого доступа или атаки."
  },
  en: {
    rules_violation: "The account's content or activity violated the publication rules.",
    spam_and_manipulation: "Mass messaging, artificial promotion, or other manipulation was detected.",
    law_or_rights_violation: "A violation of law, copyright, or other rights was detected.",
    security_threat: "The restriction protects the account and service from compromise, misuse, or attack."
  }
}

const APPEAL_MESSAGE_MIN = 20
const APPEAL_MESSAGE_MAX = 2000
const APPEAL_TOKEN_TTL_HOURS = 24

const isDuplicate = (error: unknown): boolean =>
  typeof error === "object" && error !== null && Reflect.get(error, "code") === "P2002"

const requiredReason = (value: string, requestId: string): string => {
  const normalized = value.trim()
  if (!normalized) throw createApiError("VALIDATION_ERROR", { requestId, field: "reason", rule: "required" })
  return normalized
}

const validMessage = (value: string, requestId: string): string => {
  const normalized = value.trim()
  if (normalized.length < APPEAL_MESSAGE_MIN || normalized.length > APPEAL_MESSAGE_MAX) {
    throw createApiError("VALIDATION_ERROR", {
      requestId,
      field: "message",
      rule: `${APPEAL_MESSAGE_MIN}..${APPEAL_MESSAGE_MAX} characters`
    })
  }
  return normalized
}

const appealSelect = {
  id: true,
  status: true,
  submittedAt: true,
  decidedAt: true,
  archivedAt: true,
  reasonCategory: true,
  staffMessage: true,
  planTier: true,
  planUntil: true
} as const satisfies Prisma.AccountAppealSelect

const userSelect = {
  id: true,
  email: true,
  locale: true,
  role: true,
  handle: true,
  archivedAt: true,
  archiveMode: true,
  archiveReasonCategory: true,
  archivePublicMessage: true,
  planTier: true,
  planUntil: true,
  accountAppeal: { select: appealSelect }
} as const satisfies Prisma.UserSelect

type AppealUser = Prisma.UserGetPayload<{ select: typeof userSelect }>

const invalidToken = (ctx: GraphQLContext): never => {
  throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "accountAppeal" })
}

async function loadAppealUser(ctx: GraphQLContext, token: string, now: Date): Promise<AppealUser> {
  const record = await ctx.prisma.accountAppealToken.findUnique({
    where: { tokenHash: hashOpaqueToken(token) },
    select: { expiresAt: true, user: { select: userSelect } }
  })
  if (!record || record.expiresAt <= now) return invalidToken(ctx)

  const user = record.user
  if (user.archiveMode === "self") {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "account.appeal" })
  }
  if (!user.archivedAt && user.accountAppeal?.status !== "restored") return invalidToken(ctx)
  if (!user.accountAppeal && (!user.archiveReasonCategory || !user.archivedAt)) return invalidToken(ctx)
  return user
}

/** Входная ссылка обменивается на отдельный 24-часовой токен, который не создаёт сессию. */
export async function issueAccountAppealToken(ctx: GraphQLContext, userId: string, now = new Date()): Promise<string> {
  const token = randomBytes(32).toString("hex")
  const tokenHash = hashOpaqueToken(token)
  const expiresAt = addHours(now, APPEAL_TOKEN_TTL_HOURS)
  await ctx.prisma.accountAppealToken.upsert({
    where: { userId },
    update: { tokenHash, expiresAt, createdAt: now },
    create: { userId, tokenHash, expiresAt, createdAt: now }
  })
  return token
}

const publicView = (user: AppealUser): PublicAccountAppealView => {
  const saved = user.accountAppeal
  const archivedAt = saved?.archivedAt ?? user.archivedAt
  const reasonCategory = saved?.reasonCategory ?? user.archiveReasonCategory
  if (!archivedAt || !reasonCategory) throw new Error("Administrative archive is missing its public reason")
  const planTier = saved?.planTier ?? user.planTier
  const planUntil = saved?.planUntil ?? user.planUntil

  return {
    locale: user.locale,
    archivedAt,
    reasonCategory,
    explanation: explanations[user.locale][reasonCategory],
    staffMessage: saved?.staffMessage ?? user.archivePublicMessage,
    plan: planTier !== "free" && planUntil ? { tier: planTier, until: planUntil } : null,
    appeal: {
      id: saved?.id ?? null,
      status: saved?.status ?? "none",
      submittedAt: saved?.submittedAt ?? null,
      decidedAt: saved?.decidedAt ?? null
    },
    canSubmit: Boolean(user.archivedAt) && !saved
  }
}

/** Публичное чтение без сессии: право даёт только живая ссылка входа административного архива. */
export async function readAccountAppeal(
  ctx: GraphQLContext,
  token: string,
  now = new Date()
): Promise<PublicAccountAppealView> {
  const ip = ctx.requestMeta?.ip ?? null
  await ctx.rateLimiter.enforce("appeal.form.ip", ip ?? "unknown", { requestId: ctx.requestId, ip })
  return publicView(await loadAppealUser(ctx, token, now))
}

/** Уникальный `userId` в БД закрывает и обычный повтор, и две параллельные отправки формы. */
export async function submitAccountAppeal(
  ctx: GraphQLContext,
  input: { token: string; message: string },
  now = new Date()
): Promise<PublicAccountAppealView["appeal"]> {
  const message = validMessage(input.message, ctx.requestId)
  const user = await loadAppealUser(ctx, input.token, now)
  if (user.accountAppeal) {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "accountAppeal",
      expected: "none",
      actual: user.accountAppeal.status
    })
  }

  try {
    const appeal = await ctx.prisma.$transaction(async (tx) => {
      const created = await tx.accountAppeal.create({
        data: {
          userId: user.id,
          message,
          submittedAt: now,
          archivedAt: user.archivedAt!,
          reasonCategory: user.archiveReasonCategory!,
          staffMessage: user.archivePublicMessage,
          planTier: user.planTier,
          planUntil: user.planUntil
        },
        select: appealSelect
      })
      await tx.auditLog.create({
        data: {
          action: "user.appeal.submit",
          actorId: null,
          actorRole: null,
          entityType: "user",
          entityId: user.id,
          diff: { targetId: user.id, appealId: created.id },
          requestId: ctx.requestId
        }
      })
      return created
    })
    return {
      id: appeal.id,
      status: appeal.status,
      submittedAt: appeal.submittedAt,
      decidedAt: appeal.decidedAt
    }
  } catch (error: unknown) {
    if (!isDuplicate(error)) throw error
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "accountAppeal",
      expected: "none",
      actual: "submitted"
    })
  }
}

interface DecisionRecord {
  appeal: PublicAccountAppealView["appeal"]
  user: { id: string; email: string; locale: Locale; handle: string }
}

/** Решение меняет обращение и, для `restore`, аккаунт одной транзакцией; статьи не возвращаются. */
export async function decideAccountAppeal(
  ctx: GraphQLContext,
  input: { id: string; decision: AccountAppealDecision; reason: string },
  now = new Date()
): Promise<{ appeal: PublicAccountAppealView["appeal"] }> {
  ensureRole(ctx.currentUser, "admin", "account.appeal.decide", ctx.requestId)
  const actor = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  const reason = requiredReason(input.reason, ctx.requestId)

  const result = await ctx.prisma.$transaction(async (tx): Promise<DecisionRecord> => {
    const existing = await tx.accountAppeal.findUnique({
      where: { id: input.id },
      include: {
        user: { select: { id: true, email: true, locale: true, handle: true, archivedAt: true, archiveMode: true } }
      }
    })
    if (!existing) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "accountAppeal" })
    if (existing.status !== "submitted") {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "accountAppeal",
        expected: "submitted",
        actual: existing.status
      })
    }
    if (!existing.user.archivedAt || existing.user.archiveMode === "self") {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "user",
        expected: "archived_admin",
        actual: "active"
      })
    }

    const status: AccountAppealStatus = input.decision === "restore" ? "restored" : "confirmed"
    if (input.decision === "restore") {
      const restored = await tx.user.updateMany({
        where: { id: existing.user.id, archivedAt: { not: null }, archiveMode: { in: ["admin", "emergency"] } },
        data: {
          archivedAt: null,
          archiveMode: null,
          archivedByActorId: null,
          archivedByRole: null,
          archiveReason: null,
          archiveReasonCategory: null,
          archivePublicMessage: null
        }
      })
      if (restored.count !== 1) {
        throw createApiError("CONFLICT", {
          requestId: ctx.requestId,
          entity: "user",
          expected: "archived_admin",
          actual: "active"
        })
      }
      const articlesLeftArchived = await tx.article.count({
        where: { authorId: existing.user.id, status: "archived" }
      })
      await tx.auditLog.create({
        data: {
          action: "user.restore",
          actorId: actor.id,
          actorRole: actor.role,
          entityType: "user",
          entityId: existing.user.id,
          diff: {
            targetId: existing.user.id,
            mode: existing.user.archiveMode,
            reason,
            articlesLeftArchived
          },
          requestId: ctx.requestId
        }
      })
    }

    const updated = await tx.accountAppeal.updateMany({
      where: { id: existing.id, status: "submitted" },
      data: {
        status,
        decidedAt: now,
        decidedByActorId: actor.id,
        decidedByRole: actor.role as Role,
        decisionReason: reason
      }
    })
    if (updated.count !== 1) {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "accountAppeal",
        expected: "submitted",
        actual: status
      })
    }

    await tx.auditLog.create({
      data: {
        action: "user.appeal.decide",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: existing.user.id,
        diff: { targetId: existing.user.id, appealId: existing.id, decision: input.decision, reason },
        requestId: ctx.requestId
      }
    })

    return {
      user: existing.user,
      appeal: { id: existing.id, status, submittedAt: existing.submittedAt, decidedAt: now }
    }
  })

  if (input.decision === "restore") await ctx.cache.delByTags([authorCacheTag(result.user.handle)])

  const { message, sanitizedBody } = createAccountAppealDecisionMail(result.user.locale, {
    decision: input.decision,
    reason
  })
  try {
    await ctx.mail.send({
      template: ACCOUNT_APPEAL_DECISION_TEMPLATE,
      to: result.user.email,
      content: { subject: message.subject, text: message.text, html: message.html },
      sanitizedBody,
      objectType: "accountAppeal",
      objectId: input.id,
      requestId: ctx.requestId
    })
  } catch {
    // Решение уже записано; служба писем фиксирует `mail.failed`, повтор решения создал бы дубль.
  }

  return { appeal: result.appeal }
}
