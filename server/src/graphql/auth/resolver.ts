import { addMinutes } from "date-fns"
import crypto from "crypto"
import jwt from "jsonwebtoken"
import { GraphQLError } from "graphql"

if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error("JWT secrets must be defined in environment variables.")
}

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET

export default {
  Mutation: {
    requestMagicLink: async (_: any, { email }: { email: string }, { prisma }: any) => {
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
      const expiresAt = addMinutes(new Date(), 15)

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

      // In a real app, you'd send an email here.
      // For now, we'll log the link to the console.
      const magicLink = `http://localhost:3000/auth/verify?token=${token}`
      console.log(`✨ Magic Link for ${email}: ${magicLink}`)

      return true
    },
    verifyMagicLink: async (_: any, { token }: { token: string }, { prisma }: any) => {
      const magicLinkToken = await prisma.magicLinkToken.findUnique({
        where: { token },
        include: { user: true }
      })

      if (!magicLinkToken) {
        throw new GraphQLError("Invalid or expired magic link.")
      }

      if (magicLinkToken.usedAt) {
        throw new GraphQLError("This magic link has already been used.")
      }

      if (new Date() > magicLinkToken.expiresAt) {
        throw new GraphQLError("This magic link has expired.")
      }

      // Mark the token as used
      await prisma.magicLinkToken.update({
        where: { id: magicLinkToken.id },
        data: { usedAt: new Date() }
      })

      const user = magicLinkToken.user

      const accessToken = jwt.sign({ userId: user.id, role: user.role }, JWT_ACCESS_SECRET, {
        expiresIn: "15m"
      })

      const refreshToken = jwt.sign({ userId: user.id }, JWT_REFRESH_SECRET, {
        expiresIn: "7d"
      })

      return {
        accessToken,
        refreshToken,
        user
      }
    }
  }
}
