import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  findUnique: vi.fn()
}))

vi.mock("jsonwebtoken", () => ({ default: { verify: mocks.verify } }))
vi.mock("../src/generated/prisma", () => ({
  PrismaClient: class {
    user = { findUnique: mocks.findUnique }
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
})

const cache = {} as never
const piiHasher = {} as never
const initialContext = {
  request: new Request("http://localhost/graphql", {
    headers: { authorization: "Bearer invalid" }
  })
} as never

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

      const context = await createContext(initialContext, cache, logger, piiHasher)

      expect(context.currentUser).toBeNull()
      expect(logger.log).not.toHaveBeenCalled()
    }
  )

  it("logs an unexpected user lookup failure without token data", async () => {
    mocks.verify.mockReturnValue({ userId: "user-1" })
    mocks.findUnique.mockRejectedValue(new Error("database unavailable"))
    const logger = { log: vi.fn() }

    const context = await createContext(initialContext, cache, logger, piiHasher)

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
