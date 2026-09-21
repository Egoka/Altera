import { addMinutes } from "date-fns"
import crypto from "crypto"
import jwt from "jsonwebtoken"
import type { GraphQLContext } from "../../prisma"
import { createApiError } from "../../errors/graphql-error"
import { hashOpaqueToken } from "../../auth/token-hash"
import { isEmailAddress, normalizeEmail } from "../../auth/email-address"
import { createUserWithReservedHandle, isPrismaUniqueConstraint } from "../../auth/handle"
import {
  findSessionByRefreshToken,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  startSession,
  type SessionClient
} from "../../auth/session"
import { sanitizeNextPath } from "../../auth/next-path"
import { findOutdatedConsent, readLegalVersions, recordConsent, type LegalVersions } from "../../auth/legal"
import { createMagicLinkMail, MAGIC_LINK_TEMPLATE } from "../../mail/messages"
import type { Locale, MagicLinkToken, User } from "../../generated/prisma"

if (!process.env.JWT_ACCESS_SECRET) {
  throw new Error("JWT secrets must be defined in environment variables.")
}

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET
const JWT_ACCESS_TOKEN_EXPIRY = process.env.JWT_ACCESS_TOKEN_EXPIRY || "15m"
const MAGIC_LINK_EXPIRY_MINUTES = parseInt(process.env.MAGIC_LINK_EXPIRY_MINUTES || "15")
const MAGIC_LINK_BASE_URL = process.env.MAGIC_LINK_BASE_URL || "http://localhost:3000/auth/verify"

interface ConsentVersionsInput {
  termsVersion?: number | null
  privacyVersion?: number | null
}

interface SessionPayload {
  accessToken: string
  refreshToken: string
  user: User
}

const buildMagicLinkUrl = (token: string): string => {
  const url = new URL(MAGIC_LINK_BASE_URL)
  url.searchParams.set("token", token)
  return url.toString()
}

const sameVersion = (accepted: number | null | undefined, current: number | null): boolean =>
  current === null ? accepted === null || accepted === undefined : accepted === current

// Роль в клейм не попадает: она читается из базы на каждый запрос (ADR-0003 п. 4, ADR-0009 п. 6).
const issueAccessToken = (userId: string, sessionId: string): string =>
  (jwt as any).sign({ userId, sid: sessionId }, JWT_ACCESS_SECRET, { expiresIn: JWT_ACCESS_TOKEN_EXPIRY })

const sessionClient = (ctx: GraphQLContext): SessionClient => ctx.prisma as unknown as SessionClient

/**
 * Сессия выдаётся хранилищем T-023: непрозрачный refresh-токен с ротацией и обнаружением
 * повторного предъявления (ADR-0009 п. 3, `session-lifecycle.md` §2.4–2.5). Контракт входа
 * остаётся контрактом T-022, поэтому ветки подтверждения ссылки получают ту же полезную нагрузку.
 */
async function issueSession(ctx: GraphQLContext, user: User, options: { limited?: boolean } = {}) {
  // Метаданные запроса приходят от BFF; серверные и тестовые вызовы могут их не передавать.
  const meta = ctx.requestMeta ?? { userAgent: null, ip: null }
  const { session, refreshToken } = await startSession(sessionClient(ctx), user.id, meta, new Date(), {
    limited: options.limited ?? false
  })

  return { accessToken: issueAccessToken(user.id, session.id), refreshToken, user, sessionId: session.id }
}

interface VerifyMagicLinkResult {
  outcome: "authenticated" | "consent_required" | "archived_self" | "archived_admin"
  session: SessionPayload | null
  next: string | null
  isNewAccount: boolean
  termsVersion: number | null
  privacyVersion: number | null
  appealToken: string | null
}

/**
 * Токен входа одноразовый: неизвестный, использованный и истёкший отвечают одинаково
 * (`NOT_FOUND`, docs/spec/20-public/verify.md §4), чтобы ответ не подсказывал, какой
 * именно токен когда-то существовал.
 */
async function loadUsableToken(ctx: GraphQLContext, token: string): Promise<MagicLinkToken> {
  const { prisma, logger, requestId } = ctx
  const record = await prisma.magicLinkToken.findUnique({ where: { tokenHash: hashOpaqueToken(token) } })

  const reason = !record ? "unknown" : record.usedAt ? "used" : new Date() > record.expiresAt ? "expired" : null
  if (reason !== null || !record) {
    logger.log({
      level: "warn",
      event: "auth.login.failed",
      requestId,
      message: "Magic link rejected",
      data: { reason }
    })
    throw createApiError("NOT_FOUND", { requestId, entity: "magicLink" })
  }

  return record
}

async function completeLogin(
  ctx: GraphQLContext,
  record: MagicLinkToken,
  user: User,
  options: { isNewAccount: boolean }
): Promise<VerifyMagicLinkResult> {
  const { prisma, logger, piiHasher, requestId } = ctx

  await prisma.magicLinkToken.update({ where: { id: record.id }, data: { usedAt: new Date() } })
  const { sessionId, ...session } = await issueSession(ctx, user)

  logger.log({
    level: "info",
    event: "auth.login",
    requestId,
    message: "Login completed",
    data: { emailHash: piiHasher.email(user.email), isNewAccount: options.isNewAccount, sessionId }
  })

  return {
    outcome: "authenticated",
    session,
    next: record.next,
    isNewAccount: options.isNewAccount,
    termsVersion: null,
    privacyVersion: null,
    appealToken: null
  }
}

export default {
  Query: {
    legalVersions: async (_: unknown, { locale }: { locale: Locale }, ctx: GraphQLContext): Promise<LegalVersions> =>
      readLegalVersions(ctx.prisma, locale)
  },
  Mutation: {
    requestMagicLink: async (
      _: unknown,
      {
        email,
        consentVersion,
        locale,
        next
      }: { email: string; consentVersion: ConsentVersionsInput; locale: Locale; next?: string | null },
      ctx: GraphQLContext
    ) => {
      const { prisma, logger, piiHasher, requestId, mail, rateLimiter } = ctx
      const address = normalizeEmail(email)

      if (!isEmailAddress(address)) {
        throw createApiError("VALIDATION_ERROR", { requestId, field: "email", rule: "email format" })
      }

      // Корзина адреса — на первом же шаге, до любого чтения о существовании аккаунта
      // (`rate-limits.md` §2 п. 3: 5 в час на e-mail). Прав у гостя нет, проверять перед лимитом
      // нечего, а ответ `RATE_LIMITED` одинаков для известного и неизвестного адреса.
      // Корзину по IP применяет middleware до резолвера.
      const limit = await rateLimiter.enforce("auth.link.email", address, { requestId, ip: ctx.requestMeta?.ip })

      // Согласие требуется всегда при отсутствии сессии и сверяется с действующими версиями
      // (docs/spec/20-public/login.md §4, ADR-0028).
      const current = await readLegalVersions(prisma, locale)
      if (
        !sameVersion(consentVersion?.termsVersion, current.termsVersion) ||
        !sameVersion(consentVersion?.privacyVersion, current.privacyVersion)
      ) {
        throw createApiError("VALIDATION_ERROR", {
          requestId,
          field: "consentVersion",
          rule: "current published legal versions"
        })
      }

      // Письмо уходит на основном языке аккаунта; для нового адреса — на языке страницы
      // (журнал §20.11). Ответ мутации от результата этого поиска не зависит.
      const existing = await prisma.user.findUnique({ where: { email: address }, select: { locale: true } })
      const mailLocale = existing?.locale ?? locale

      const token = crypto.randomBytes(32).toString("hex")
      const tokenHash = hashOpaqueToken(token)
      const expiresAt = addMinutes(new Date(), MAGIC_LINK_EXPIRY_MINUTES)
      const nextPath = sanitizeNextPath(next)
      const payload = {
        tokenHash,
        locale: mailLocale,
        next: nextPath,
        termsVersion: current.termsVersion,
        privacyVersion: current.privacyVersion,
        expiresAt,
        usedAt: null
      }

      // Повторный запрос отзывает прежний токен адреса (docs/spec/20-public/login.md §7).
      await prisma.magicLinkToken.upsert({
        where: { email: address },
        update: payload,
        create: { email: address, ...payload }
      })

      const { message, sanitizedBody } = createMagicLinkMail(mailLocale, buildMagicLinkUrl(token))
      await mail.send({
        template: MAGIC_LINK_TEMPLATE,
        to: address,
        content: { subject: message.subject, text: message.text, html: message.html },
        sanitizedBody,
        requestId
      })

      logger.log({
        level: "info",
        event: "auth.link.requested",
        requestId,
        message: "Magic link requested",
        data: { emailHash: piiHasher.email(address) }
      })

      // Одинаков для существующего и неизвестного адреса: ни поля, ни ветка не различаются.
      // Таймер кнопки «отправить ещё раз» (docs/spec/20-public/login.md §5) показывается, когда
      // запрос израсходовал последнее обращение окна: отдельного значения паузы спецификация не
      // задаёт, поэтому иначе поле остаётся пустым.
      return { ok: true, retryAfterSec: limit.remaining === 0 ? limit.retryAfter : null }
    },

    verifyMagicLink: async (
      _: unknown,
      { token }: { token: string },
      ctx: GraphQLContext
    ): Promise<VerifyMagicLinkResult> => {
      const { prisma, logger, piiHasher, requestId } = ctx
      const record = await loadUsableToken(ctx, token)
      const user = await prisma.user.findUnique({ where: { email: record.email } })

      if (!user) {
        // Первый вход создаёт аккаунт: читатель, план free, случайный хэндл, версия согласия
        // (журнал §25.1, `session-lifecycle.md` п. 2).
        let created: User
        try {
          created = await createUserWithReservedHandle(prisma, {
            email: record.email,
            name: record.email.split("@")[0],
            locale: record.locale
          })
        } catch (error: unknown) {
          // Параллельный обмен ссылки из второй вкладки мог уже завести аккаунт.
          if (!isPrismaUniqueConstraint(error, "email")) throw error
          const concurrent = await prisma.user.findUnique({ where: { email: record.email } })
          if (!concurrent) throw error
          return completeLogin(ctx, record, concurrent, { isNewAccount: false })
        }

        await recordConsent(prisma, {
          userId: created.id,
          locale: record.locale,
          termsVersion: record.termsVersion,
          privacyVersion: record.privacyVersion
        })

        return completeLogin(ctx, record, created, { isNewAccount: true })
      }

      if (user.archivedAt) {
        if (user.archiveMode === "self") {
          // Ограниченная сессия: доступен только экран состояния (`session-lifecycle.md` п. 7).
          await prisma.magicLinkToken.update({ where: { id: record.id }, data: { usedAt: new Date() } })
          const { sessionId, ...session } = await issueSession(ctx, user, { limited: true })

          logger.log({
            level: "info",
            event: "auth.login",
            requestId,
            message: "Limited login into self-archived account",
            data: { emailHash: piiHasher.email(user.email), reason: "archived_self", sessionId }
          })

          return {
            outcome: "archived_self",
            session,
            next: null,
            isNewAccount: false,
            termsVersion: null,
            privacyVersion: null,
            appealToken: null
          }
        }

        // Административный архив: сессии нет; форма оспаривания открывается тем же токеном
        // входа (журнал #48), поэтому токен не гасится.
        logger.log({
          level: "warn",
          event: "auth.login.failed",
          requestId,
          message: "Login into administratively archived account",
          data: { reason: "archived_admin" }
        })

        return {
          outcome: "archived_admin",
          session: null,
          next: null,
          isNewAccount: false,
          termsVersion: null,
          privacyVersion: null,
          appealToken: token
        }
      }

      const outdated = await findOutdatedConsent(prisma, user.id, user.locale)
      if (outdated) {
        // Токен остаётся действующим до принятия новых версий (`acceptConsent`).
        return {
          outcome: "consent_required",
          session: null,
          next: record.next,
          isNewAccount: false,
          termsVersion: outdated.termsVersion,
          privacyVersion: outdated.privacyVersion,
          appealToken: null
        }
      }

      return completeLogin(ctx, record, user, { isNewAccount: false })
    },

    acceptConsent: async (
      _: unknown,
      {
        token,
        termsVersion,
        privacyVersion
      }: { token: string; termsVersion?: number | null; privacyVersion?: number | null },
      ctx: GraphQLContext
    ): Promise<VerifyMagicLinkResult> => {
      const { prisma, requestId } = ctx
      const record = await loadUsableToken(ctx, token)
      const user = await prisma.user.findUnique({ where: { email: record.email } })
      if (!user) throw createApiError("NOT_FOUND", { requestId, entity: "user" })

      const current = await readLegalVersions(prisma, user.locale)
      if (!sameVersion(termsVersion, current.termsVersion) || !sameVersion(privacyVersion, current.privacyVersion)) {
        throw createApiError("VALIDATION_ERROR", {
          requestId,
          field: "termsVersion",
          rule: "current published legal versions"
        })
      }

      await recordConsent(prisma, {
        userId: user.id,
        locale: user.locale,
        termsVersion: current.termsVersion,
        privacyVersion: current.privacyVersion
      })

      return completeLogin(ctx, record, user, { isNewAccount: false })
    },

    refreshSession: async (_: unknown, { refreshToken }: { refreshToken: string }, ctx: GraphQLContext) => {
      const { prisma, logger, requestId, requestMeta } = ctx
      const outcome = await rotateSession(sessionClient(ctx), refreshToken, requestMeta)

      if (outcome.status === "reuse_detected") {
        // Предъявлен уже ротированный токен: это кража, а не гонка обновления (ADR-0009 п. 3).
        logger.log({
          level: "warn",
          event: "session.reuse_detected",
          requestId,
          message: "Rotated refresh token presented again",
          data: { userId: outcome.userId, sessionId: outcome.sessionId, revokedCount: outcome.revokedCount }
        })
        logger.log({
          level: "warn",
          event: "session.revoked",
          requestId,
          message: "All user sessions revoked after refresh token reuse",
          data: { userId: outcome.userId, reason: "reuse_detected", revokedCount: outcome.revokedCount }
        })
        throw createApiError("UNAUTHENTICATED", { requestId })
      }

      if (outcome.status !== "rotated") {
        throw createApiError("UNAUTHENTICATED", { requestId })
      }

      const user = await prisma.user.findUnique({ where: { id: outcome.session.userId } })
      if (!user) {
        throw createApiError("UNAUTHENTICATED", { requestId })
      }

      logger.log({
        level: "info",
        event: "session.refresh",
        requestId,
        message: "Session refreshed",
        data: { userId: user.id, sessionId: outcome.session.id }
      })

      return {
        accessToken: issueAccessToken(user.id, outcome.session.id),
        refreshToken: outcome.refreshToken,
        user
      }
    },

    logout: async (_: unknown, { refreshToken }: { refreshToken?: string | null }, ctx: GraphQLContext) => {
      const { logger, requestId, sessionId, currentUser } = ctx
      const client = sessionClient(ctx)
      const session = sessionId
        ? { id: sessionId, userId: currentUser?.id ?? null }
        : refreshToken
          ? await findSessionByRefreshToken(client, refreshToken)
          : null

      if (!session) {
        throw createApiError("UNAUTHENTICATED", { requestId })
      }

      const revokedCount = await revokeSession(client, session.id)
      logger.log({
        level: "info",
        event: "session.revoked",
        requestId,
        message: "Session revoked on logout",
        data: { userId: session.userId, sessionId: session.id, reason: "logout", revokedCount }
      })

      return true
    },

    logoutAll: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      const { logger, requestId, currentUser } = ctx
      if (!currentUser) {
        throw createApiError("UNAUTHENTICATED", { requestId })
      }

      // Текущая сессия тоже отзывается: после `logoutAll` активных сессий не остаётся (ADR-0009 п. 4).
      const revokedCount = await revokeAllSessions(sessionClient(ctx), currentUser.id)
      logger.log({
        level: "info",
        event: "session.revoked",
        requestId,
        message: "All user sessions revoked",
        data: { userId: currentUser.id, reason: "logout_all", revokedCount }
      })

      return true
    }
  }
}
