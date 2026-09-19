import { Prisma, PrismaClient } from "./generated/prisma"
import jwt from "jsonwebtoken"
import { YogaInitialContext } from "graphql-yoga"
import type { Cache } from "./cache"
import type { MailService } from "./mail/service"
import type { AppLogger } from "./observability/logger"
import type { PiiHasher } from "./observability/privacy"
import { getRequestId, setRequestUserSnapshot } from "./observability/request-tracing"

if (!process.env.JWT_ACCESS_SECRET) {
  throw new Error("JWT_ACCESS_SECRET must be defined in environment variables.")
}
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET
const expectedJwtErrorNames = new Set(["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"])

export const prisma = new PrismaClient()
type AuthenticatedUser = Prisma.UserGetPayload<{ include: { permissionExceptions: true } }>

export interface GraphQLContext {
  prisma: PrismaClient
  currentUser: AuthenticatedUser | null
  cache: Cache
  requestId: string
  logger: AppLogger
  piiHasher: PiiHasher
  mail: MailService
}

export async function createContext(
  initialContext: YogaInitialContext,
  cache: Cache,
  logger: AppLogger,
  piiHasher: PiiHasher,
  mail: MailService
): Promise<GraphQLContext> {
  const requestId = getRequestId()
  const authorization = initialContext.request.headers.get("authorization")
  let currentUser: AuthenticatedUser | null = null

  if (authorization) {
    const token = authorization.replace("Bearer ", "")
    try {
      const decoded = jwt.verify(token, JWT_ACCESS_SECRET) as { userId: string }
      if (decoded && decoded.userId) {
        currentUser = await prisma.user.findUnique({
          where: { id: decoded.userId },
          include: {
            permissionExceptions: { where: { revokedAt: null } }
          }
        })
      }
    } catch (error: unknown) {
      // Invalid, expired and not-yet-active credentials are expected authentication outcomes.
      if (!(error instanceof Error && expectedJwtErrorNames.has(error.name))) {
        logger.log({
          level: "error",
          event: "error.unhandled",
          requestId,
          message: "JWT verification failed",
          error
        })
      }
      currentUser = null // Ensure user is null if token is invalid
    }
  }

  setRequestUserSnapshot(currentUser ? { id: currentUser.id, role: currentUser.role } : null)
  return { prisma, currentUser, cache, requestId, logger, piiHasher, mail }
}
