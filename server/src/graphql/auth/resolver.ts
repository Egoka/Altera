import { addMinutes } from "date-fns"
import crypto from "crypto"
import jwt from "jsonwebtoken"
import type { GraphQLContext } from "../../prisma"
import { createApiError } from "../../errors/graphql-error"
import { hashOpaqueToken } from "../../auth/token-hash"
import { createUserWithReservedHandle, isPrismaUniqueConstraint } from "../../auth/handle"
import {
  findSessionByRefreshToken,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  startSession,
  type SessionClient
} from "../../auth/session"
import { createMagicLinkMail, MAGIC_LINK_TEMPLATE } from "../../mail/messages"
import type { Locale, User } from "../../generated/prisma"

if (!process.env.JWT_ACCESS_SECRET) {
  throw new Error("JWT secrets must be defined in environment variables.")
}

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET
const JWT_ACCESS_TOKEN_EXPIRY = process.env.JWT_ACCESS_TOKEN_EXPIRY || "15m"
const MAGIC_LINK_EXPIRY_MINUTES = parseInt(process.env.MAGIC_LINK_EXPIRY_MINUTES || "15")
const MAGIC_LINK_BASE_URL = process.env.MAGIC_LINK_BASE_URL || "http://localhost:3000/auth/verify"

const buildMagicLinkUrl = (token: string): string => {
  const url = new URL(MAGIC_LINK_BASE_URL)
  url.searchParams.set("token", token)
  return url.toString()
}

// Роль в клейм не попадает: она читается из базы на каждый запрос (ADR-0003 п. 4, ADR-0009 п. 6).
const issueAccessToken = (userId: string, sessionId: string): string =>
  (jwt as any).sign({ userId, sid: sessionId }, JWT_ACCESS_SECRET, { expiresIn: JWT_ACCESS_TOKEN_EXPIRY })

const sessionClient = (ctx: GraphQLContext): SessionClient => ctx.prisma as unknown as SessionClient

export default {
  Mutation: {
    requestMagicLink: async (_: unknown, { email, locale }: { email: string; locale: Locale }, ctx: GraphQLContext) => {
      const { prisma, logger, piiHasher, requestId, mail } = ctx
      const user = await prisma.user.findUnique({ where: { email } })

      let targetUser: User
      if (!user) {
        const username = email.split("@")[0]
        try {
          targetUser = await createUserWithReservedHandle(prisma, { email, name: username, locale })
        } catch (error: unknown) {
          if (!isPrismaUniqueConstraint(error, "email")) throw error

          const concurrentUser = await prisma.user.findUnique({ where: { email } })
          if (!concurrentUser) {
            throw error
          }
          targetUser = concurrentUser
        }
      } else {
        targetUser = user
      }

      const token = crypto.randomBytes(32).toString("hex")
      const tokenHash = hashOpaqueToken(token)
      const expiresAt = addMinutes(new Date(), MAGIC_LINK_EXPIRY_MINUTES)

      await prisma.magicLinkToken.upsert({
        where: { userId: targetUser.id },
        update: {
          tokenHash,
          expiresAt,
          usedAt: null // Ensure the token is marked as not used on update
        },
        create: {
          tokenHash,
          userId: targetUser.id,
          expiresAt
        }
      })

      const { message, sanitizedBody } = createMagicLinkMail(locale, buildMagicLinkUrl(token))
      await mail.send({
        template: MAGIC_LINK_TEMPLATE,
        to: email,
        content: { subject: message.subject, text: message.text, html: message.html },
        sanitizedBody,
        requestId
      })

      logger.log({
        level: "info",
        event: "auth.link.requested",
        requestId,
        message: "Magic link requested",
        data: { emailHash: piiHasher.email(email) }
      })

      return true
    },
    verifyMagicLink: async (_: unknown, { token }: { token: string }, ctx: GraphQLContext) => {
      const { prisma, logger, requestId, requestMeta } = ctx
      const tokenHash = hashOpaqueToken(token)
      const magicLinkToken = await prisma.magicLinkToken.findUnique({
        where: { tokenHash },
        include: { user: true }
      })

      if (!magicLinkToken) {
        throw createApiError("NOT_FOUND", { requestId, entity: "magicLink" })
      }

      if (magicLinkToken.usedAt) {
        throw createApiError("CONFLICT", {
          requestId,
          entity: "magicLink",
          expected: "unused",
          actual: "used"
        })
      }

      if (new Date() > magicLinkToken.expiresAt) {
        throw createApiError("CONFLICT", {
          requestId,
          entity: "magicLink",
          expected: "active",
          actual: "expired"
        })
      }

      // Mark the token as used
      await prisma.magicLinkToken.update({
        where: { id: magicLinkToken.id },
        data: { usedAt: new Date() }
      })

      const user = magicLinkToken.user
      const { session, refreshToken } = await startSession(sessionClient(ctx), user.id, requestMeta)

      logger.log({
        level: "info",
        event: "auth.login",
        requestId,
        message: "Session started",
        data: { userId: user.id, sessionId: session.id }
      })

      return {
        accessToken: issueAccessToken(user.id, session.id),
        refreshToken,
        user
      }
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
