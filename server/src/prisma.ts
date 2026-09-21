import { Prisma, PrismaClient } from "./generated/prisma"
import jwt from "jsonwebtoken"
import { YogaInitialContext } from "graphql-yoga"
import type { Cache } from "./cache"
import type { ErrorCollector } from "./error-collector"
import type { MailService } from "./mail/service"
import type { AppLogger } from "./observability/logger"
import type { PiiHasher } from "./observability/privacy"
import type { RateLimiter } from "./rate-limits"
import type { SessionMeta } from "./auth/session"
import { getRequestId, setRequestUserSnapshot } from "./observability/request-tracing"

if (!process.env.JWT_ACCESS_SECRET) {
  throw new Error("JWT_ACCESS_SECRET must be defined in environment variables.")
}
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET
const expectedJwtErrorNames = new Set(["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"])
const MAX_USER_AGENT_LENGTH = 512

export const prisma = new PrismaClient()
type AuthenticatedUser = Prisma.UserGetPayload<{ include: { permissionExceptions: true } }>

export interface GraphQLContext {
  prisma: PrismaClient
  currentUser: AuthenticatedUser | null
  sessionId: string | null
  requestMeta: SessionMeta
  cache: Cache
  requestId: string
  logger: AppLogger
  piiHasher: PiiHasher
  mail: MailService
  // Единые пороги лимитов частоты: корзины по e-mail и аккаунту применяются в резолверах,
  // корзины по адресу — middleware до резолвера (`50-access/rate-limits.md` §2 п. 13).
  rateLimiter: RateLimiter
  // История `backend.error` и адаптер внешнего сборщика (`80-observability/error-collector.md`).
  errorCollector: ErrorCollector
}

// Браузер ходит только через BFF, поэтому адрес приходит заголовком прокси; поле
// информационное (список устройств) и на решения доступа не влияет.
function readRequestMeta(request: Request): SessionMeta {
  const forwardedFor = request.headers.get("x-forwarded-for")
  const userAgent = request.headers.get("user-agent")

  return {
    ip: forwardedFor?.split(",")[0]?.trim() || null,
    userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null
  }
}

export async function createContext(
  initialContext: YogaInitialContext,
  cache: Cache,
  logger: AppLogger,
  piiHasher: PiiHasher,
  mail: MailService,
  rateLimiter: RateLimiter,
  errorCollector: ErrorCollector
): Promise<GraphQLContext> {
  const requestId = getRequestId()
  const requestMeta = readRequestMeta(initialContext.request)
  const authorization = initialContext.request.headers.get("authorization")
  let currentUser: AuthenticatedUser | null = null
  let sessionId: string | null = null

  if (authorization) {
    const token = authorization.replace("Bearer ", "")
    try {
      const decoded = jwt.verify(token, JWT_ACCESS_SECRET) as { userId?: string; sid?: string }
      if (decoded?.userId && decoded.sid) {
        // Одно индексированное чтение проверяет и сессию, и пользователя: отзыв действует
        // на следующем запросе без ожидания истечения access-токена (ADR-0009 п. 2).
        const session = await prisma.session.findUnique({
          where: { id: decoded.sid },
          include: {
            user: {
              include: {
                permissionExceptions: { where: { revokedAt: null } }
              }
            }
          }
        })

        if (
          session &&
          session.userId === decoded.userId &&
          session.revokedAt === null &&
          session.expiresAt > new Date()
        ) {
          currentUser = session.user
          sessionId = session.id
        }
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
      sessionId = null
    }
  }

  setRequestUserSnapshot(currentUser ? { id: currentUser.id, role: currentUser.role } : null)
  return {
    prisma,
    currentUser,
    sessionId,
    requestMeta,
    cache,
    requestId,
    logger,
    piiHasher,
    mail,
    rateLimiter,
    errorCollector
  }
}
