import type { GraphQLContext } from "../../prisma"
import { issueAccountAppealToken } from "../../account/appeal"
import { createApiError } from "../../errors/graphql-error"
import { ensureAuthenticated } from "../../exceptions/permissions"
import { isEmailAddress, normalizeEmail } from "../../auth/email-address"
import { createUserWithReservedHandle, isPrismaUniqueConstraint } from "../../auth/handle"
import { findOutdatedConsent, readLegalVersions, recordConsent } from "../../auth/legal"
import { issueLoginSession } from "../../auth/login"
import { sanitizeNextPath } from "../../auth/next-path"
import {
  assertPasswordAcceptable,
  hashPassword,
  needsRehash,
  verifyAgainstDummyPassword,
  verifyPassword
} from "../../auth/password"
import {
  buildAuthUrl,
  buildSiteUrl,
  consumePasswordToken,
  dropPasswordTokens,
  findUsablePasswordToken,
  issuePasswordToken,
  passwordTokenExpiryMinutes,
  type PasswordTokenStore
} from "../../auth/password-tokens"
import { revokeAllSessions, type SessionClient } from "../../auth/session"
import { hashOpaqueToken } from "../../auth/token-hash"
import { EMPTY_ACCOUNT_NAME } from "../../visibility/display-name"
import {
  createAccountExistsMail,
  createEmailConfirmMail,
  createPasswordResetMail,
  EMAIL_CONFIRM_TEMPLATE,
  PASSWORD_ACCOUNT_EXISTS_TEMPLATE,
  PASSWORD_RESET_TEMPLATE
} from "../../mail/messages"
import { isForwardedByBff } from "../../observability/request-tracing"
import { resolveRateLimitAddress } from "../../rate-limits"
import { randomBytes } from "node:crypto"
import { addMinutes } from "date-fns"
import type { Locale, PasswordTokenPurpose, User } from "../../generated/prisma"

/**
 * Ветка пароля (журнал §34 п. 6–8, T-115): регистрация с паролем, подтверждение адреса, вход,
 * сброс письмом и смена пароля в кабинете. Ветка ссылки (T-022) остаётся как есть — способы
 * равноправны, и аккаунт без пароля продолжает входить по ссылке.
 *
 * Общие правила ветки:
 *
 * - ответ не раскрывает существование аккаунта: регистрация и запрос сброса отвечают одинаково
 *   на свободный и занятый адрес (`20-public/login.md` §4), а неверный пароль и неизвестный
 *   адрес дают один и тот же `UNAUTHENTICATED` после равной по стоимости проверки;
 * - учитываются только неуспешные проверки пароля — RL-14 (5 за 15 минут на адрес) и RL-15
 *   (30 на IP), утверждённые владельцем (журнал §44 п. 1); успешная проверка очищает корзину
 *   адреса, постоянной блокировки аккаунта нет;
 * - пароль и его нормализованное значение не попадают ни в лог, ни в историю писем.
 */

const CONFIRM_PATH = "/auth/confirm"
const RESET_PATH = "/auth/reset"
const LOGIN_PATH = "/login"

interface ConsentVersionsInput {
  termsVersion?: number | null
  privacyVersion?: number | null
}

interface PasswordLoginResult {
  outcome: "authenticated" | "email_unconfirmed" | "consent_required" | "archived_self" | "archived_admin"
  session: { accessToken: string; refreshToken: string; user: User } | null
  next: string | null
  termsVersion: number | null
  privacyVersion: number | null
  appealToken: string | null
  consentToken: string | null
}

const sessionClient = (ctx: GraphQLContext): SessionClient => ctx.prisma as unknown as SessionClient
const tokenStore = (ctx: GraphQLContext): PasswordTokenStore => ctx.prisma as unknown as PasswordTokenStore

const sameVersion = (accepted: number | null | undefined, current: number | null): boolean =>
  current === null ? accepted === null || accepted === undefined : accepted === current

const outcomeOnly = (outcome: PasswordLoginResult["outcome"]): PasswordLoginResult => ({
  outcome,
  session: null,
  next: null,
  termsVersion: null,
  privacyVersion: null,
  appealToken: null,
  consentToken: null
})

/** Ключ корзины по адресу — тот же, что у middleware: адрес доверенный только от своего BFF. */
const addressKey = (ctx: GraphQLContext) => {
  const address = resolveRateLimitAddress(ctx.requestMeta?.ip, isForwardedByBff())
  return { key: address.key, ip: address.kind === "client" ? address.key : null }
}

const passwordHints = (user: Pick<User, "email" | "handle" | "name">) => ({
  email: user.email,
  handle: user.handle,
  name: user.name === EMPTY_ACCOUNT_NAME ? null : user.name
})

const requireEmail = (email: string, requestId: string): string => {
  const address = normalizeEmail(email)
  if (!isEmailAddress(address)) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "email", rule: "email format" })
  }

  return address
}

/**
 * Письмо ветки пароля со ссылкой. Отказ почты поднимается наружу как `PROVIDER_UNAVAILABLE`
 * самой службой писем: пользователь должен увидеть «письмо не отправлено», а не «готово».
 */
async function sendPasswordBranchMail(
  ctx: GraphQLContext,
  input: { to: string; locale: Locale; purpose: PasswordTokenPurpose; next?: string | null }
): Promise<void> {
  const { token } = await issuePasswordToken(tokenStore(ctx), {
    email: input.to,
    purpose: input.purpose,
    locale: input.locale,
    next: input.next ?? null
  })
  const expiryMinutes = passwordTokenExpiryMinutes()
  const confirming = input.purpose === "email_confirm"
  const url = buildAuthUrl(confirming ? CONFIRM_PATH : RESET_PATH, token)
  const { message, sanitizedBody } = confirming
    ? createEmailConfirmMail(input.locale, url, expiryMinutes)
    : createPasswordResetMail(input.locale, url, expiryMinutes)

  await ctx.mail.send({
    template: confirming ? EMAIL_CONFIRM_TEMPLATE : PASSWORD_RESET_TEMPLATE,
    to: input.to,
    content: { subject: message.subject, text: message.text, html: message.html },
    sanitizedBody,
    requestId: ctx.requestId
  })
}

/**
 * Экран повторного согласия принадлежит ветке ссылки (`/auth/verify`), поэтому вход по паролю с
 * устаревшим согласием выдаёт такой же одноразовый токен входа — письма для него не нужно:
 * владение аккаунтом уже доказано паролем. Прежний токен адреса при этом отзывается, как и при
 * повторном запросе ссылки (`20-public/login.md` §7).
 */
async function issueConsentToken(ctx: GraphQLContext, user: User, next: string | null): Promise<string> {
  const token = randomBytes(32).toString("hex")
  const current = await readLegalVersions(ctx.prisma, user.locale)
  const payload = {
    tokenHash: hashOpaqueToken(token),
    locale: user.locale,
    next,
    termsVersion: current.termsVersion,
    privacyVersion: current.privacyVersion,
    expiresAt: addMinutes(new Date(), passwordTokenExpiryMinutes()),
    usedAt: null
  }
  await ctx.prisma.magicLinkToken.upsert({
    where: { email: user.email },
    update: payload,
    create: { email: user.email, ...payload }
  })

  return token
}

/**
 * Что происходит после доказанного владения аккаунтом — паролем или одноразовой ссылкой ветки
 * пароля. Ветки состояния те же, что у входа по ссылке (`10-flows/register-and-login.md` §4):
 * административный архив сессии не получает, самостоятельный получает ограниченную, устаревшее
 * согласие уводит на экран согласия.
 */
async function completePasswordLogin(
  ctx: GraphQLContext,
  user: User,
  options: { next?: string | null; reason: string }
): Promise<PasswordLoginResult> {
  const { logger, piiHasher, requestId } = ctx
  const next = sanitizeNextPath(options.next)

  if (user.archivedAt && user.archiveMode !== "self") {
    logger.log({
      level: "warn",
      event: "auth.login.failed",
      requestId,
      message: "Login into administratively archived account",
      data: { reason: "archived_admin" }
    })

    // Как и вход по ссылке, вход по паролю выдаёт отдельный 24-часовой токен формы оспаривания
    // (журнал #48, `blocked-appeal.md`): форма принимает только его.
    return { ...outcomeOnly("archived_admin"), appealToken: await issueAccountAppealToken(ctx, user.id) }
  }

  if (user.archivedAt) {
    const { sessionId, ...session } = await issueLoginSession(sessionClient(ctx), user, ctx.requestMeta, {
      limited: true
    })
    logger.log({
      level: "info",
      event: "auth.login",
      requestId,
      message: "Limited login into self-archived account",
      data: { emailHash: piiHasher.email(user.email), reason: "archived_self", sessionId }
    })

    return { ...outcomeOnly("archived_self"), session }
  }

  const outdated = await findOutdatedConsent(ctx.prisma, user.id, user.locale)
  if (outdated) {
    return {
      ...outcomeOnly("consent_required"),
      next,
      termsVersion: outdated.termsVersion,
      privacyVersion: outdated.privacyVersion,
      consentToken: await issueConsentToken(ctx, user, next)
    }
  }

  const { sessionId, ...session } = await issueLoginSession(sessionClient(ctx), user, ctx.requestMeta)
  logger.log({
    level: "info",
    event: "auth.login",
    requestId,
    message: "Login completed",
    data: { emailHash: piiHasher.email(user.email), reason: options.reason, sessionId }
  })

  return { ...outcomeOnly("authenticated"), session, next }
}

export default {
  AccountUser: {
    passwordSet: async (parent: { id: string }, _args: unknown, ctx: GraphQLContext): Promise<boolean> => {
      const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
      if (parent.id !== user.id) {
        throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "password.read" })
      }

      return Boolean(user.passwordHash)
    }
  },

  Mutation: {
    registerWithPassword: async (
      _: unknown,
      {
        email,
        password,
        consentVersion,
        locale,
        next
      }: {
        email: string
        password: string
        consentVersion: ConsentVersionsInput
        locale: Locale
        next?: string | null
      },
      ctx: GraphQLContext
    ) => {
      const { prisma, logger, piiHasher, requestId, rateLimiter } = ctx
      const address = requireEmail(email, requestId)
      const ip = addressKey(ctx).ip

      // Корзина адреса — до любого чтения о существовании аккаунта, как у запроса ссылки
      // (§2 п. 3); корзину по IP применяет middleware до резолвера.
      const limit = await rateLimiter.enforce("auth.link.email", address, { requestId, ip })

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

      const normalized = assertPasswordAcceptable(password, { requestId, hints: { email: address } })
      const nextPath = sanitizeNextPath(next)
      const existing = await prisma.user.findUnique({ where: { email: address } })
      const retryAfterSec = limit.remaining === 0 ? limit.retryAfter : null

      if (existing?.emailVerifiedAt) {
        // Занятый подтверждённый адрес: чужой аккаунт не меняется, а владелец ящика узнаёт о
        // попытке письмом. Ответ мутации от этой ветки не отличается.
        const notice = createAccountExistsMail(existing.locale, buildSiteUrl(LOGIN_PATH))
        await ctx.mail.send({
          template: PASSWORD_ACCOUNT_EXISTS_TEMPLATE,
          to: address,
          content: {
            subject: notice.message.subject,
            text: notice.message.text,
            html: notice.message.html
          },
          sanitizedBody: notice.sanitizedBody,
          objectType: "user",
          objectId: existing.id,
          requestId
        })

        return { ok: true, retryAfterSec }
      }

      const passwordHash = await hashPassword(normalized)

      if (existing) {
        // Неподтверждённая запись — это незаконченная регистрация: пользоваться ею нельзя
        // (вход по паролю закрыт, вход по ссылке снимает пароль), поэтому повторная регистрация
        // того же адреса продолжает её, а не отвечает `CONFLICT`.
        await prisma.user.update({
          where: { id: existing.id },
          data: { passwordHash, passwordUpdatedAt: new Date(), locale }
        })
      } else {
        try {
          const created = await createUserWithReservedHandle(prisma, {
            email: address,
            // Имя не выводится из адреса (ADR-0018 п. 3, журнал §25.4).
            name: EMPTY_ACCOUNT_NAME,
            locale,
            passwordHash,
            passwordUpdatedAt: new Date(),
            emailVerifiedAt: null
          })

          await recordConsent(prisma, {
            userId: created.id,
            locale,
            termsVersion: current.termsVersion,
            privacyVersion: current.privacyVersion
          })
        } catch (error: unknown) {
          // Параллельная регистрация того же адреса из второй вкладки уже завела запись.
          if (!isPrismaUniqueConstraint(error, "email")) throw error
        }
      }

      await sendPasswordBranchMail(ctx, {
        to: address,
        locale,
        purpose: "email_confirm",
        next: nextPath
      })

      logger.log({
        level: "info",
        event: "auth.link.requested",
        requestId,
        message: "Password registration requested",
        data: { emailHash: piiHasher.email(address) }
      })

      return { ok: true, retryAfterSec }
    },

    confirmEmail: async (
      _: unknown,
      { token }: { token: string },
      ctx: GraphQLContext
    ): Promise<PasswordLoginResult> => {
      const { prisma, logger, requestId } = ctx
      const record = await findUsablePasswordToken(tokenStore(ctx), token, "email_confirm")
      const user = record ? await prisma.user.findUnique({ where: { email: record.email } }) : null

      if (!record || !user) {
        // Неизвестный, использованный и истёкший токен отвечают одинаково (`verify.md` §4).
        logger.log({
          level: "warn",
          event: "auth.login.failed",
          requestId,
          message: "Email confirmation token rejected",
          data: { reason: "unknown" }
        })
        throw createApiError("NOT_FOUND", { requestId, entity: "emailConfirmation" })
      }

      if (!(await consumePasswordToken(tokenStore(ctx), record))) {
        throw createApiError("NOT_FOUND", { requestId, entity: "emailConfirmation" })
      }

      const confirmed = user.emailVerifiedAt
        ? user
        : await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } })

      return completePasswordLogin(ctx, confirmed, { next: record.next, reason: "email_confirm" })
    },

    loginWithPassword: async (
      _: unknown,
      { email, password, next }: { email: string; password: string; next?: string | null },
      ctx: GraphQLContext
    ): Promise<PasswordLoginResult> => {
      const { prisma, logger, piiHasher, requestId, rateLimiter } = ctx
      const address = requireEmail(email, requestId)
      const { key, ip } = addressKey(ctx)
      const limitContext = { requestId, ip }

      // Обе корзины проверяются до чтения базы и до хэширования: отказ по любой из них
      // отклоняет попытку (RL-14, RL-15). Сама попытка учитывается только по её исходу.
      await rateLimiter.assertWithin("auth.password.email", address, limitContext)
      await rateLimiter.assertWithin("auth.password.ip", key, limitContext)

      const user = await prisma.user.findUnique({ where: { email: address } })
      const verified = user?.passwordHash
        ? await verifyPassword(user.passwordHash, password)
        : await verifyAgainstDummyPassword(password)

      if (!user || !verified) {
        await rateLimiter.penalize("auth.password.email", address, limitContext)
        await rateLimiter.penalize("auth.password.ip", key, limitContext)
        logger.log({
          level: "warn",
          event: "auth.login.failed",
          requestId,
          message: "Password rejected",
          data: { reason: "password" }
        })
        throw createApiError("UNAUTHENTICATED", { requestId })
      }

      // Пароль верен: корзина адреса очищается, чтобы прежние опечатки не копились до лимита.
      await rateLimiter.forget("auth.password.email", address)

      if (!user.emailVerifiedAt) {
        // Регистрация не закончена: сессии нет, письмо с подтверждением уходит заново — его
        // прочитает только владелец ящика, поэтому это не канал рассылки.
        await sendPasswordBranchMail(ctx, {
          to: user.email,
          locale: user.locale,
          purpose: "email_confirm",
          next: sanitizeNextPath(next)
        })
        logger.log({
          level: "warn",
          event: "auth.login.failed",
          requestId,
          message: "Password login before address confirmation",
          data: { emailHash: piiHasher.email(user.email), reason: "email_unconfirmed" }
        })

        return outcomeOnly("email_unconfirmed")
      }

      // Параметры хранения могли вырасти: пересчёт идёт на успешном входе, пароль уже под рукой.
      if (user.passwordHash && needsRehash(user.passwordHash)) {
        await prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: await hashPassword(password) }
        })
      }

      return completePasswordLogin(ctx, user, { next, reason: "password" })
    },

    requestPasswordReset: async (
      _: unknown,
      { email, locale }: { email: string; locale: Locale },
      ctx: GraphQLContext
    ) => {
      const { prisma, logger, piiHasher, requestId, rateLimiter } = ctx
      const address = requireEmail(email, requestId)
      const ip = addressKey(ctx).ip
      const limit = await rateLimiter.enforce("auth.link.email", address, { requestId, ip })

      const user = await prisma.user.findUnique({ where: { email: address } })
      if (user) {
        // Письмо уходит на основном языке аккаунта, а не страницы (журнал §20.11); у неизвестного
        // адреса основного языка нет, и локаль страницы осталась бы единственной — письма для него
        // всё равно не будет. Ответ мутации от этой ветки не зависит.
        await sendPasswordBranchMail(ctx, { to: address, locale: user.locale ?? locale, purpose: "password_reset" })
      }

      logger.log({
        level: "info",
        event: "auth.link.requested",
        requestId,
        message: "Password reset requested",
        data: { emailHash: piiHasher.email(address) }
      })

      // Ответ одинаков для существующего и неизвестного адреса: ни поля, ни ветка не различаются
      // (`20-public/login.md` §4, критерий 3 задачи T-115).
      return { ok: true, retryAfterSec: limit.remaining === 0 ? limit.retryAfter : null }
    },

    resetPassword: async (
      _: unknown,
      { token, password }: { token: string; password: string },
      ctx: GraphQLContext
    ): Promise<PasswordLoginResult> => {
      const { prisma, logger, requestId } = ctx
      const record = await findUsablePasswordToken(tokenStore(ctx), token, "password_reset")
      const user = record ? await prisma.user.findUnique({ where: { email: record.email } }) : null

      if (!record || !user) {
        logger.log({
          level: "warn",
          event: "auth.login.failed",
          requestId,
          message: "Password reset token rejected",
          data: { reason: "unknown" }
        })
        throw createApiError("NOT_FOUND", { requestId, entity: "passwordReset" })
      }

      // Требования проверяются до гашения токена: непринятый пароль не должен тратить ссылку.
      const normalized = assertPasswordAcceptable(password, {
        requestId,
        field: "newPassword",
        hints: passwordHints(user)
      })

      if (!(await consumePasswordToken(tokenStore(ctx), record))) {
        throw createApiError("NOT_FOUND", { requestId, entity: "passwordReset" })
      }

      const now = new Date()
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(normalized),
          passwordUpdatedAt: now,
          // Переход по ссылке из письма доказывает владение адресом, как и ссылка входа.
          emailVerifiedAt: user.emailVerifiedAt ?? now
        }
      })
      await dropPasswordTokens(tokenStore(ctx), user.email, ["email_confirm"])

      // Сброс пароля — ответ на потерю доступа: прежние сессии закрываются все, даже если пароль
      // менял сам владелец. Новая сессия выдаётся ниже.
      const revokedCount = await revokeAllSessions(sessionClient(ctx), user.id, now)
      logger.log({
        level: "info",
        event: "session.revoked",
        requestId,
        message: "All user sessions revoked after password reset",
        data: { userId: user.id, reason: "password_reset", revokedCount }
      })

      return completePasswordLogin(ctx, updated, { next: record.next, reason: "password_reset" })
    },

    setPassword: async (
      _: unknown,
      { currentPassword, newPassword }: { currentPassword?: string | null; newPassword: string },
      ctx: GraphQLContext
    ): Promise<boolean> => {
      const { prisma, logger, requestId, rateLimiter, sessionId } = ctx
      const actor = ensureAuthenticated(ctx.currentUser, requestId)
      // Ограниченная сессия архивированного аккаунта видит только экран состояния.
      if (actor.archivedAt) throw createApiError("FORBIDDEN", { requestId, action: "password.change" })

      const { key, ip } = addressKey(ctx)
      const limitContext = { requestId, ip }
      await rateLimiter.enforce("account.mutation.user", actor.id, limitContext)

      if (actor.passwordHash) {
        // Смена пароля проверяет текущий, и этот перебор идёт в те же корзины, что и вход:
        // иначе лимит обходился бы одной украденной сессией.
        await rateLimiter.assertWithin("auth.password.email", actor.email, limitContext)
        await rateLimiter.assertWithin("auth.password.ip", key, limitContext)

        const matches = currentPassword ? await verifyPassword(actor.passwordHash, currentPassword) : false
        if (!matches) {
          await rateLimiter.penalize("auth.password.email", actor.email, limitContext)
          await rateLimiter.penalize("auth.password.ip", key, limitContext)
          throw createApiError("VALIDATION_ERROR", { requestId, field: "currentPassword", rule: "current password" })
        }

        await rateLimiter.forget("auth.password.email", actor.email)
      }

      const normalized = assertPasswordAcceptable(newPassword, {
        requestId,
        field: "newPassword",
        hints: passwordHints(actor)
      })

      const now = new Date()
      await prisma.user.update({
        where: { id: actor.id },
        data: { passwordHash: await hashPassword(normalized), passwordUpdatedAt: now }
      })
      await dropPasswordTokens(tokenStore(ctx), actor.email, ["password_reset"])

      // Остальные устройства закрываются: новый пароль не должен оставлять старым сессиям
      // доступ. Текущая сессия остаётся — иначе смена пароля выбрасывала бы со своего же экрана.
      const revokedCount = await revokeAllSessions(sessionClient(ctx), actor.id, now, {
        exceptSessionId: sessionId
      })
      logger.log({
        level: "info",
        event: "session.revoked",
        requestId,
        message: "Other user sessions revoked after password change",
        data: { userId: actor.id, sessionId, reason: "password_change", revokedCount }
      })

      return true
    }
  }
}
