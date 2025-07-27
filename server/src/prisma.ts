import { PrismaClient, User } from "./generated/prisma"
import jwt from "jsonwebtoken"
import { YogaInitialContext } from "graphql-yoga"

if (!process.env.JWT_ACCESS_SECRET) {
  throw new Error("JWT_ACCESS_SECRET must be defined in environment variables.")
}
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET

const prisma = new PrismaClient()

export interface GraphQLContext {
  prisma: PrismaClient
  currentUser: User | null
}

export async function createContext(initialContext: YogaInitialContext): Promise<GraphQLContext> {
  const authorization = initialContext.request.headers.get("authorization")
  let currentUser: User | null = null

  if (authorization) {
    const token = authorization.replace("Bearer ", "")
    try {
      const decoded = jwt.verify(token, JWT_ACCESS_SECRET) as { userId: string }
      if (decoded && decoded.userId) {
        currentUser = await prisma.user.findUnique({
          where: { id: decoded.userId }
        })
      }
    } catch (error: any) {
      // We only want to log unexpected errors, not expected ones like token expiration.
      if (error.name !== "TokenExpiredError") {
        console.error("JWT verification error:", error)
      }
      currentUser = null // Ensure user is null if token is invalid
    }
  }

  return { prisma, currentUser }
}
