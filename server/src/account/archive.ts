import crypto from "crypto"
import { addMinutes, differenceInCalendarDays } from "date-fns"
import { createApiError } from "../errors/graphql-error"
import { issueAccessToken } from "../auth/access-token"
import { revokeAllSessions, startSession, type SessionClient, type SessionMeta } from "../auth/session"
import { hashOpaqueToken } from "../auth/token-hash"
import { ACCOUNT_ARCHIVE_CONFIRM_TEMPLATE, createAccountArchiveConfirmMail } from "../mail/messages"
import { deriveAccountSubscription, type AccountSubscriptionView } from "./dashboard"
import type { AccountArchiveMode, Locale, PrismaClient, Role, User } from "../generated/prisma"
import type { MailService } from "../mail/service"
import type { RateLimiter } from "../rate-limits"

/**
 * «Удалить аккаунт» = самостоятельное архивирование (журнал §5.1–2, §25.7;
 * `30-account/reader/delete-account.md`, `archived-state.md`, `10-flows/delete-account.md`).
 *
 * Доступ закрывается сразу, данные сохраняются: подтверждение по ссылке в одной транзакции
 * ставит `archivedAt`, `archiveMode = self`, отзывает все сессии и каскадно архивирует статьи
 * с актором «сам пользователь» (журнал §3.3, #4). При следующем входе выдаётся ограниченная
 * сессия и экран состояния, откуда пользователь восстанавливает себя сам (матрица #116).
 * Восстановление возвращает только аккаунт: статьи остаются в архиве и возвращаются автором
 * по одной (журнал §5.4, §25.7). Оплаченный план идёт без возврата и без паузы (журнал #50),
 * поэтому выдачи здесь не трогаются ни в одной ветке.
 */

/** [ДОПУЩЕНИЕ] Срок ссылки подтверждения — 60 минут (`delete-account.md` §3, §12). */
export const ARCHIVE_CONFIRM_EXPIRY_MINUTES = 60

const CONFIRM_PATH = "/me/delete/confirm"

/**
 * Ссылка ведёт на страницу веба. Отдельной переменной окружения задача не вводит: origin сайта
 * уже настроен для писем входа, и подтверждение обязано жить на том же домене — иначе сессия
 * того же аккаунта, которой требует §4, на странице подтверждения не предъявится.
 */
const frontendOrigin = (): string =>
  process.env.FRONTEND_URL || new URL(process.env.MAGIC_LINK_BASE_URL || "http://localhost:3000/auth/verify").origin

export const buildArchiveConfirmUrl = (token: string): string => {
  const url = new URL(CONFIRM_PATH, frontendOrigin())
  url.searchParams.set("token", token)
  return url.toString()
}

export type AccountArchiveStore = Pick<
  PrismaClient,
  "accountArchiveRequest" | "user" | "article" | "session" | "auditLog" | "planGrant" | "$transaction"
>

export interface AccountArchiveActor {
  id: string
  email: string
  role: Role
  locale: Locale
  archivedAt: Date | null
  archiveMode: AccountArchiveMode | null
  isServiceAccount: boolean
}

export interface AccountArchiveContext {
  store: AccountArchiveStore
  actor: AccountArchiveActor
  requestId: string
  mail: MailService
  rateLimiter: RateLimiter
  requestMeta: SessionMeta
  ip?: string | null
  now?: Date
}

export interface AccountArchivePendingView {
  requestedAt: Date
  expiresAt: Date
}

export interface AccountArchivePreviewView {
  articlesCount: number
  plan: AccountSubscriptionView | null
  isLastOwner: boolean
  pending: AccountArchivePendingView | null
}

export interface AccountArchiveStateView {
  archivedAt: Date
  mode: AccountArchiveMode
  articlesArchived: number
  plan: AccountSubscriptionView | null
  canRestore: boolean
}

export interface AccountRestoreView {
  restored: boolean
  accessToken: string
  refreshToken: string
  user: User
}

// Планы есть только у личных ролей: служебная запись их не покупает (журнал §8.17).
const personalRoles = new Set<Role>(["reader", "author"])

const activeStatuses = { not: "archived" } as const

async function readPlan(context: AccountArchiveContext, now: Date): Promise<AccountSubscriptionView | null> {
  const { actor, store } = context
  if (actor.isServiceAccount || !personalRoles.has(actor.role)) return null

  const grants = await store.planGrant.findMany({
    where: { userId: actor.id },
    select: { tier: true, startsAt: true, endsAt: true, revokedAt: true }
  })

  return deriveAccountSubscription(grants, now)
}

/**
 * Инвариант владельца (`50-access/roles/owner.md`, журнал #10): система не может остаться без
 * владельца, поэтому последний `owner` не архивирует себя сам. Считаются только действующие
 * записи: архивированный владелец владельцем уже не работает.
 */
async function isLastOwner(context: AccountArchiveContext): Promise<boolean> {
  if (context.actor.role !== "owner") return false

  const owners = await context.store.user.count({ where: { role: "owner", archivedAt: null } })
  return owners <= 1
}

const toPending = (
  request: { createdAt: Date; expiresAt: Date } | null,
  now: Date
): AccountArchivePendingView | null =>
  request && request.expiresAt > now ? { requestedAt: request.createdAt, expiresAt: request.expiresAt } : null

/** Экран всегда показывает последствия (§8): пустого состояния у страницы нет. */
export async function readArchivePreview(context: AccountArchiveContext): Promise<AccountArchivePreviewView> {
  const now = context.now ?? new Date()
  const { actor, store } = context

  const [articlesCount, request, lastOwner, plan] = await Promise.all([
    store.article.count({ where: { authorId: actor.id, status: activeStatuses } }),
    store.accountArchiveRequest.findUnique({ where: { userId: actor.id } }),
    isLastOwner(context),
    readPlan(context, now)
  ])

  return { articlesCount, plan, isLastOwner: lastOwner, pending: toPending(request, now) }
}

/**
 * Шаг 2 flow #12: письмо с одноразовой ссылкой. Режим один — `self` (журнал #4): параметр
 * зарезервирован на будущее, административный архив выполняется не отсюда (T-073).
 */
export async function requestAccountArchive(
  context: AccountArchiveContext,
  mode: AccountArchiveMode
): Promise<AccountArchivePreviewView> {
  const { actor, requestId, store } = context
  const now = context.now ?? new Date()

  if (mode !== "self") {
    throw createApiError("FORBIDDEN", { requestId, action: "account.archive.self" })
  }
  if (await isLastOwner(context)) {
    throw createApiError("CONFLICT", {
      requestId,
      entity: "user",
      expected: "another owner",
      actual: "last owner"
    })
  }

  const open = await store.accountArchiveRequest.findUnique({ where: { userId: actor.id } })
  if (open && open.expiresAt > now) {
    throw createApiError("CONFLICT", {
      requestId,
      entity: "accountArchive",
      expected: "no open request",
      actual: "open request"
    })
  }

  // Лимит — последним, после проверки прав и инварианта (`permission-checks.md` п. 3):
  // 1 запрос в сутки на аккаунт (`rate-limits.md` §2 п. 8).
  await context.rateLimiter.enforce("account.archive.user", actor.id, { requestId, ip: context.ip })

  const token = crypto.randomBytes(32).toString("hex")
  const payload = {
    tokenHash: hashOpaqueToken(token),
    expiresAt: addMinutes(now, ARCHIVE_CONFIRM_EXPIRY_MINUTES),
    createdAt: now
  }
  await store.accountArchiveRequest.upsert({
    where: { userId: actor.id },
    update: payload,
    create: { userId: actor.id, ...payload }
  })

  const { message, sanitizedBody } = createAccountArchiveConfirmMail(
    actor.locale,
    buildArchiveConfirmUrl(token),
    ARCHIVE_CONFIRM_EXPIRY_MINUTES
  )
  await context.mail.send({
    template: ACCOUNT_ARCHIVE_CONFIRM_TEMPLATE,
    to: actor.email,
    content: { subject: message.subject, text: message.text, html: message.html },
    sanitizedBody,
    objectType: "user",
    objectId: actor.id,
    requestId
  })

  return readArchivePreview({ ...context, now })
}

export async function cancelAccountArchive(context: AccountArchiveContext): Promise<AccountArchivePreviewView> {
  await context.store.accountArchiveRequest.deleteMany({ where: { userId: context.actor.id } })
  return readArchivePreview(context)
}

/**
 * Шаг 3 flow #12 одной транзакцией: архив аккаунта, отзыв всех сессий и каскадный архив статей
 * с актором «сам пользователь» (журнал §3.3). Медиа закрывается вместе с материалами: доступ к
 * файлу выводится из статуса статьи и её автора (журнал §11), отдельной отметки у него нет.
 *
 * Действующую запись гарантирует вызывающий: страница подтверждения закрыта для архивированного
 * аккаунта так же, как и сама форма (`delete-account.md` §3).
 */
export async function confirmAccountArchive(context: AccountArchiveContext, token: string): Promise<number> {
  const { actor, requestId, store } = context
  const now = context.now ?? new Date()

  const request = await store.accountArchiveRequest.findUnique({ where: { tokenHash: hashOpaqueToken(token) } })
  // Чужой, неизвестный и истёкший токен отвечают одинаково (§8): ответ не подсказывает, какая
  // ссылка когда-то существовала. Подтверждение требует сессии того же аккаунта (§4 `[ДОПУЩЕНИЕ]`).
  if (!request || request.userId !== actor.id || request.expiresAt <= now) {
    if (request && request.userId === actor.id) {
      await store.accountArchiveRequest.deleteMany({ where: { userId: actor.id } })
    }
    throw createApiError("NOT_FOUND", { requestId, entity: "accountArchive" })
  }

  if (await isLastOwner(context)) {
    throw createApiError("CONFLICT", {
      requestId,
      entity: "user",
      expected: "another owner",
      actual: "last owner"
    })
  }

  return store.$transaction(async (tx) => {
    const articles = await tx.article.findMany({
      where: { authorId: actor.id, status: activeStatuses },
      select: { id: true, status: true }
    })

    await tx.user.update({
      where: { id: actor.id },
      data: {
        archivedAt: now,
        archiveMode: "self",
        archivedByActorId: actor.id,
        archivedByRole: actor.role,
        archiveReason: "self"
      }
    })

    if (articles.length > 0) {
      // Архив каскадный, но актор у каждой статьи — сам автор: иначе `restoreArticle` посчитал
      // бы их архивом сотрудника и не дал вернуть после восстановления (журнал §4.2–4).
      await tx.article.updateMany({
        where: { authorId: actor.id, status: activeStatuses },
        data: {
          status: "archived",
          archivedAt: now,
          archivedByActorId: actor.id,
          archivedByRole: actor.role,
          archiveReason: "account_archive"
        }
      })
      await tx.auditLog.createMany({
        data: articles.map((article) => ({
          action: "article.archive",
          actorId: actor.id,
          actorRole: actor.role,
          entityType: "article",
          entityId: article.id,
          diff: { status: { from: article.status, to: "archived" }, actor: "self", cascade: true },
          requestId
        }))
      })
    }

    const revokedCount = await revokeAllSessions(tx as unknown as SessionClient, actor.id, now)

    await tx.auditLog.create({
      data: {
        action: "user.archive.self",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: actor.id,
        diff: { mode: "self", articlesArchived: articles.length, sessionsRevoked: revokedCount },
        requestId
      }
    })

    await tx.accountArchiveRequest.deleteMany({ where: { userId: actor.id } })

    return articles.length
  })
}

/** Экран состояния доступен только самостоятельно архивированной записи (матрица #116). */
export async function readArchiveState(context: AccountArchiveContext): Promise<AccountArchiveStateView> {
  const { actor, requestId, store } = context
  const now = context.now ?? new Date()

  // Два разных отказа: действующему аккаунту экран состояния не нужен вовсе, а
  // административно архивированному он не поможет — там только оспаривание (журнал #48).
  // Страница различает их по `action`: иначе она уводила бы второго обратно в кабинет,
  // а кабинет — снова сюда.
  if (!actor.archivedAt) {
    throw createApiError("FORBIDDEN", { requestId, action: "account.archive.state" })
  }
  if (actor.archiveMode !== "self") {
    throw createApiError("FORBIDDEN", { requestId, action: "account.restore.self" })
  }

  const [articlesArchived, plan] = await Promise.all([
    store.article.count({ where: { authorId: actor.id, status: "archived" } }),
    readPlan(context, now)
  ])

  return { archivedAt: actor.archivedAt, mode: actor.archiveMode, articlesArchived, plan, canRestore: true }
}

/**
 * Шаг 5 flow #12. Возвращается только аккаунт: статьи остаются в архиве и возвращаются автором
 * по одной (журнал §5.4, §25.7) — ни одна ветка здесь их не трогает. Ограниченная сессия
 * заменяется полной: повышение прав получает свой токен, а прежний перестаёт действовать.
 */
export async function restoreAccountSelf(context: AccountArchiveContext): Promise<AccountRestoreView> {
  const { actor, requestId, store } = context
  const now = context.now ?? new Date()

  if (!actor.archivedAt) {
    throw createApiError("CONFLICT", { requestId, entity: "user", expected: "archived", actual: "active" })
  }
  // Административный архив восстанавливает только `admin`/`owner`: пользователю остаётся
  // оспаривание (журнал #48, `20-public/blocked-appeal.md`).
  if (actor.archiveMode !== "self") {
    throw createApiError("FORBIDDEN", { requestId, action: "account.restore.self" })
  }

  const archivedDays = differenceInCalendarDays(now, actor.archivedAt)

  const { user, refreshToken, sessionId } = await store.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: actor.id },
      data: {
        archivedAt: null,
        archiveMode: null,
        archivedByActorId: null,
        archivedByRole: null,
        archiveReason: null
      }
    })

    await revokeAllSessions(tx as unknown as SessionClient, actor.id, now)
    const issued = await startSession(tx as unknown as SessionClient, actor.id, context.requestMeta, now)

    await tx.auditLog.create({
      data: {
        action: "user.restore.self",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: actor.id,
        diff: { mode: "self", archivedDays },
        requestId
      }
    })

    return { user, refreshToken: issued.refreshToken, sessionId: issued.session.id }
  })

  return { restored: true, accessToken: issueAccessToken(actor.id, sessionId), refreshToken, user }
}
