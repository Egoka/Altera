import { addMinutes } from "date-fns"
import crypto from "crypto"
import type { GraphQLContext } from "../../prisma"
import { createApiError } from "../../errors/graphql-error"
import { hashOpaqueToken } from "../../auth/token-hash"
import { createUserWithReservedHandle, isPrismaUniqueConstraint } from "../../auth/handle"
import { issueSession } from "../../auth/session"
import { sanitizeNextPath } from "../../auth/next-path"
import { findOutdatedConsent, readLegalVersions, recordConsent, type LegalVersions } from "../../auth/legal"
import { createMagicLinkMail, MAGIC_LINK_TEMPLATE } from "../../mail/messages"
import type { Locale, MagicLinkToken, User } from "../../generated/prisma"

const MAGIC_LINK_EXPIRY_MINUTES = parseInt(process.env.MAGIC_LINK_EXPIRY_MINUTES || "15")
const MAGIC_LINK_BASE_URL = process.env.MAGIC_LINK_BASE_URL || "http://localhost:3000/auth/verify"

// Прагматичная проверка формата: адрес всё равно подтверждается переходом по ссылке из письма.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

interface ConsentVersionsInput {
  termsVersion?: number | null
  privacyVersion?: number | null
}

const buildMagicLinkUrl = (token: string): string => {
  const url = new URL(MAGIC_LINK_BASE_URL)
  url.searchParams.set("token", token)
  return url.toString()
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase()

const sameVersion = (accepted: number | null | undefined, current: number | null): boolean =>
  current === null ? accepted === null || accepted === undefined : accepted === current

interface VerifyMagicLinkResult {
  outcome: "authenticated" | "consent_required" | "archived_self" | "archived_admin"
  session: Awaited<ReturnType<typeof issueSession>> | null
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
  const session = await issueSession(prisma, user)

  logger.log({
    level: "info",
    event: "auth.login",
    requestId,
    message: "Login completed",
    data: { emailHash: piiHasher.email(user.email), isNewAccount: options.isNewAccount }
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
      const { prisma, logger, piiHasher, requestId, mail } = ctx
      const address = normalizeEmail(email)

      if (!EMAIL_PATTERN.test(address)) {
        throw createApiError("VALIDATION_ERROR", { requestId, field: "email", rule: "email format" })
      }

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
      return { ok: true, retryAfterSec: null }
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
          const session = await issueSession(prisma, user, { limited: true })

          logger.log({
            level: "info",
            event: "auth.login",
            requestId,
            message: "Limited login into self-archived account",
            data: { emailHash: piiHasher.email(user.email), reason: "archived_self" }
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
    }
  }
}
