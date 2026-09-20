import jwt from "jsonwebtoken"
import type { GraphQLContext } from "../../prisma"
import { createApiError } from "../../errors/graphql-error"
import { hashOpaqueToken } from "../../auth/token-hash"
import { issueMagicLink } from "../../auth/magic-link"
import { createUserWithReservedHandle, isPrismaUniqueConstraint } from "../../auth/handle"
import type { Locale, User } from "../../generated/prisma"

if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error("JWT secrets must be defined in environment variables.")
}

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET
const JWT_ACCESS_TOKEN_EXPIRY = process.env.JWT_ACCESS_TOKEN_EXPIRY || "15m"
const JWT_REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_TOKEN_EXPIRY || "7d"
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

      await issueMagicLink(prisma, mail, { userId: targetUser.id, email, locale, requestId })

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
      const { prisma, requestId } = ctx
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

      const accessToken = (jwt as any).sign({ userId: user.id, role: user.role }, JWT_ACCESS_SECRET, {
        expiresIn: JWT_ACCESS_TOKEN_EXPIRY
      })

      const refreshToken = (jwt as any).sign({ userId: user.id }, JWT_REFRESH_SECRET, {
        expiresIn: JWT_REFRESH_TOKEN_EXPIRY
      })

      return {
        accessToken,
        refreshToken,
        user
      }
    }
  }
}
