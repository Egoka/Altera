import { addMinutes } from "date-fns"
import crypto from "crypto"
import jwt from "jsonwebtoken"

// TODO: Move to environment variables
const JWT_ACCESS_SECRET = "your-super-secret-access-key"
const JWT_REFRESH_SECRET = "your-super-secret-refresh-key"

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
      const expiresAt = addMinutes(new Date(), 15) // Token expires in 15 minutes

      await prisma.magicLinkToken.create({
        data: {
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
        throw new Error("Invalid or expired magic link.")
      }

      if (magicLinkToken.usedAt) {
        throw new Error("This magic link has already been used.")
      }

      if (new Date() > magicLinkToken.expiresAt) {
        throw new Error("This magic link has expired.")
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
