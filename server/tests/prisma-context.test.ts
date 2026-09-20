import { addDays, subDays } from "date-fns"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  findUnique: vi.fn(),
  sessionFindUnique: vi.fn()
}))

vi.mock("jsonwebtoken", () => ({ default: { verify: mocks.verify } }))
vi.mock("../src/generated/prisma", () => ({
  PrismaClient: class {
    user = { findUnique: mocks.findUnique }
    session = { findUnique: mocks.sessionFindUnique }
  }
}))

let createContext: typeof import("../src/prisma").createContext

beforeAll(async () => {
  vi.stubEnv("JWT_ACCESS_SECRET", "test-secret")
  ;({ createContext } = await import("../src/prisma"))
})

beforeEach(() => {
  mocks.verify.mockReset()
  mocks.findUnique.mockReset()
  mocks.sessionFindUnique.mockReset()
})

const cache = {} as never
const piiHasher = {} as never
const mail = {} as never
const initialContext = {
  request: new Request("http://localhost/graphql", {
    headers: {
      authorization: "Bearer invalid",
      "user-agent": "Chrome",
      "x-forwarded-for": "203.0.113.10, 198.51.100.7"
    }
  })
} as never

const user = { id: "user-1", role: "reader", permissionExceptions: [] }
const activeSession = {
  id: "session-1",
  userId: user.id,
  revokedAt: null,
  expiresAt: addDays(new Date(), 1),
  user
}

describe("GraphQL context authentication logging", () => {
  it.each(["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"])(
    "does not log expected JWT rejection %s as an unhandled server error",
    async (name) => {
      const error = new Error("invalid credential")
      error.name = name
      mocks.verify.mockImplementation(() => {
        throw error
      })
      const logger = { log: vi.fn() }

      const context = await createContext(initialContext, cache, logger, piiHasher, mail)

      expect(context.currentUser).toBeNull()
      expect(logger.log).not.toHaveBeenCalled()
    }
  )

  it("logs an unexpected session lookup failure without token data", async () => {
    mocks.verify.mockReturnValue({ userId: user.id, sid: activeSession.id })
    mocks.sessionFindUnique.mockRejectedValue(new Error("database unavailable"))
    const logger = { log: vi.fn() }

    const context = await createContext(initialContext, cache, logger, piiHasher, mail)

    expect(context.currentUser).toBeNull()
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "error.unhandled",
        requestId: context.requestId,
        message: "JWT verification failed",
        error: expect.any(Error)
      })
    )
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain("Bearer invalid")
  })
})

describe("GraphQL context session validation", () => {
  const logger = { log: vi.fn() }

  it("authenticates the request only through a live session record", async () => {
    mocks.verify.mockReturnValue({ userId: user.id, sid: activeSession.id })
    mocks.sessionFindUnique.mockResolvedValue(activeSession)

    const context = await createContext(initialContext, cache, logger, piiHasher, mail)

    expect(mocks.sessionFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: activeSession.id } }))
    expect(context.currentUser).toEqual(user)
    expect(context.sessionId).toBe(activeSession.id)
  })

  it.each([
    ["a revoked session", { ...activeSession, revokedAt: new Date() }],
    ["an expired session", { ...activeSession, expiresAt: subDays(new Date(), 1) }],
    ["a session of another user", { ...activeSession, userId: "user-2" }],
    ["a missing session", null]
  ])("treats %s as a visitor", async (_name, session) => {
    mocks.verify.mockReturnValue({ userId: user.id, sid: activeSession.id })
    mocks.sessionFindUnique.mockResolvedValue(session)

    const context = await createContext(initialContext, cache, logger, piiHasher, mail)

    expect(context.currentUser).toBeNull()
    expect(context.sessionId).toBeNull()
  })

  it("rejects a legacy access token issued without a session id", async () => {
    mocks.verify.mockReturnValue({ userId: user.id })

    const context = await createContext(initialContext, cache, logger, piiHasher, mail)

    expect(mocks.sessionFindUnique).not.toHaveBeenCalled()
    expect(context.currentUser).toBeNull()
  })

  it("reads the device and the first forwarded address for the session record", async () => {
    mocks.verify.mockReturnValue({ userId: user.id, sid: activeSession.id })
    mocks.sessionFindUnique.mockResolvedValue(activeSession)

    const context = await createContext(initialContext, cache, logger, piiHasher, mail)

    expect(context.requestMeta).toEqual({ userAgent: "Chrome", ip: "203.0.113.10" })
  })
})
