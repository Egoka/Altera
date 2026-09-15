import { addMinutes } from "date-fns"
import crypto from "crypto"
import jwt from "jsonwebtoken"
import type { GraphQLContext } from "../../prisma"
import { createApiError } from "../../errors/graphql-error"

if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error("JWT secrets must be defined in environment variables.")
}

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET
const JWT_ACCESS_TOKEN_EXPIRY = process.env.JWT_ACCESS_TOKEN_EXPIRY || "15m"
const JWT_REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_TOKEN_EXPIRY || "7d"
const MAGIC_LINK_EXPIRY_MINUTES = parseInt(process.env.MAGIC_LINK_EXPIRY_MINUTES || "15")
export default {
  Mutation: {
    requestMagicLink: async (_: unknown, { email }: { email: string }, ctx: GraphQLContext) => {
      const { prisma, logger, piiHasher, requestId } = ctx
      const user = await prisma.user.findUnique({ where: { email } })

      let targetUser: any
      if (!user) {
        const username = email.split("@")[0]
        targetUser = await prisma.user.create({
          data: {
            email,
            name: username,
            slug: username // Consider a more robust slug generation
          }
        })
      } else {
        targetUser = user
      }

      const token = crypto.randomBytes(32).toString("hex")
      const expiresAt = addMinutes(new Date(), MAGIC_LINK_EXPIRY_MINUTES)

      await prisma.magicLinkToken.upsert({
        where: { userId: targetUser.id },
        update: {
          token,
          expiresAt,
          usedAt: null // Ensure the token is marked as not used on update
        },
        create: {
          token,
          userId: targetUser.id,
          expiresAt
        }
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
      const { prisma, requestId } = ctx
      const magicLinkToken = await prisma.magicLinkToken.findUnique({
        where: { token },
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
