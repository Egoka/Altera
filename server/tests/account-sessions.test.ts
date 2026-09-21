import { addDays, subDays, subHours, subMinutes } from "date-fns"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import resolver from "../src/graphql/session/resolver"
import { classifyBrowser, classifyDevice } from "../src/auth/account-sessions"

/**
 * Страница «Сессии и устройства» (`docs/spec/30-account/reader/sessions.md`).
 * Проверяются строки состояний §8, права §2 и правило журнала §25.9: наружу уходят только
 * классы устройства и браузера, ни IP, ни производных от него полей.
 */

const NOW = new Date("2026-09-21T12:00:00.000Z")

type Role = "reader" | "author" | "analyst" | "admin" | "owner"

interface StoredSession {
  id: string
  userId: string
  createdAt: Date
  lastUsedAt: Date
  expiresAt: Date
  revokedAt: Date | null
  userAgent: string | null
  ip: string | null
}

const CHROME_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
const SAFARI_PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

const session = (overrides: Partial<StoredSession> = {}): StoredSession => ({
  id: "session-current",
  userId: "user-1",
  createdAt: subDays(NOW, 3),
  lastUsedAt: subMinutes(NOW, 1),
  expiresAt: addDays(NOW, 30),
  revokedAt: null,
  userAgent: CHROME_DESKTOP,
  ip: "203.0.113.10",
  ...overrides
})

interface WorldOptions {
  sessions?: StoredSession[]
  currentSessionId?: string | null
  role?: Role
  archivedAt?: Date | null
  currentUser?: boolean
}

function createWorld(options: WorldOptions = {}) {
  const rows = options.sessions ?? [
    session(),
    session({ id: "session-phone", userAgent: SAFARI_PHONE, lastUsedAt: subHours(NOW, 2) })
  ]

  const matches = (row: StoredSession, where: Record<string, unknown>): boolean => {
    if (where.userId && row.userId !== where.userId) return false
    if (typeof where.id === "string" && row.id !== where.id) return false
    const id = where.id as { not?: string } | string | undefined
    if (id && typeof id === "object" && id.not && row.id === id.not) return false
    if (where.revokedAt === null && row.revokedAt !== null) return false
    const expiresAt = where.expiresAt as { gt: Date } | undefined
    if (expiresAt && row.expiresAt <= expiresAt.gt) return false
    return true
  }

  const logger = { log: vi.fn() }
  const prisma = {
    session: {
      findMany: vi.fn(async ({ where, orderBy }: { where: Record<string, unknown>; orderBy: { lastUsedAt: string } }) =>
        rows
          .filter((row) => matches(row, where))
          .sort((left, right) =>
            orderBy.lastUsedAt === "desc"
              ? right.lastUsedAt.getTime() - left.lastUsedAt.getTime()
              : left.lastUsedAt.getTime() - right.lastUsedAt.getTime()
          )
      ),
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          rows.find((row) => row.id === where.id && row.userId === where.userId) ?? null
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: { revokedAt: Date } }) => {
        let count = 0
        for (const row of rows) {
          if (!matches(row, where)) continue
          row.revokedAt = data.revokedAt
          count += 1
        }
        return { count }
      })
    }
  }

  const currentUser =
    options.currentUser === false
      ? null
      : {
          id: "user-1",
          email: "reader@example.test",
          role: options.role ?? "reader",
          locale: "ru",
          archivedAt: options.archivedAt ?? null,
          planTier: "free",
          planUntil: null
        }

  const ctx = {
    prisma,
    currentUser,
    sessionId: options.currentSessionId === undefined ? "session-current" : options.currentSessionId,
    requestId: "request-t025",
    logger
  } as never

  return { rows, prisma, logger, ctx }
}

const list = (ctx: never) =>
  (resolver.AccountUser.sessions as (parent: { id: string }, args: unknown, ctx: never) => Promise<unknown[]>)(
    { id: "user-1" },
    {},
    ctx
  )

const revoke = (ctx: never, id: string) =>
  (resolver.Mutation.revokeSession as (parent: unknown, args: { id: string }, ctx: never) => Promise<unknown>)(
    null,
    { id },
    ctx
  )

const revokeAll = (ctx: never) =>
  (resolver.Mutation.revokeAllSessions as (parent: unknown, args: unknown, ctx: never) => Promise<unknown>)(
    null,
    {},
    ctx
  )

const codeOf = async (call: Promise<unknown>): Promise<unknown> => {
  try {
    await call
  } catch (error) {
    return (error as { extensions?: Record<string, unknown> }).extensions?.code
  }
  return null
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("own session list", () => {
  it("returns device and browser classes, newest activity first, marking the current session", async () => {
    const { ctx } = createWorld()

    expect(await list(ctx)).toEqual([
      {
        id: "session-current",
        deviceClass: "desktop",
        browserClass: "chrome",
        createdAt: subDays(NOW, 3).toISOString(),
        lastActiveAt: subMinutes(NOW, 1).toISOString(),
        isCurrent: true
      },
      {
        id: "session-phone",
        deviceClass: "mobile",
        browserClass: "safari",
        createdAt: subDays(NOW, 3).toISOString(),
        lastActiveAt: subHours(NOW, 2).toISOString(),
        isCurrent: false
      }
    ])
  })

  it("never returns the raw user-agent or the stored IP", async () => {
    const { ctx } = createWorld()
    const payload = JSON.stringify(await list(ctx))

    expect(payload).not.toContain("203.0.113.10")
    expect(payload).not.toContain("Mozilla/5.0")
  })

  it("hides revoked and expired sessions", async () => {
    const { ctx } = createWorld({
      sessions: [
        session(),
        session({ id: "session-revoked", revokedAt: subDays(NOW, 1) }),
        session({ id: "session-expired", expiresAt: subDays(NOW, 1) })
      ]
    })

    expect((await list(ctx)).map((row) => (row as { id: string }).id)).toEqual(["session-current"])
  })

  it("shows only the current session when no other device is signed in", async () => {
    const { ctx } = createWorld({ sessions: [session()] })

    expect(await list(ctx)).toHaveLength(1)
  })

  // Матрица доступа #47: свои сессии доступны каждой роли, включая служебные.
  it.each<Role>(["reader", "author", "analyst", "admin", "owner"])("lets %s read its own sessions", async (role) => {
    const { ctx } = createWorld({ role })

    expect(await list(ctx)).toHaveLength(2)
  })

  it("refuses to read sessions of another account", async () => {
    const { ctx } = createWorld()
    const call = (
      resolver.AccountUser.sessions as (parent: { id: string }, args: unknown, ctx: never) => Promise<unknown>
    )({ id: "user-2" }, {}, ctx)

    expect(await codeOf(call)).toBe("FORBIDDEN")
  })

  it("answers UNAUTHENTICATED without a session and FORBIDDEN for a limited one", async () => {
    expect(await codeOf(list(createWorld({ currentUser: false }).ctx))).toBe("UNAUTHENTICATED")
    expect(await codeOf(list(createWorld({ archivedAt: subDays(NOW, 2) }).ctx))).toBe("FORBIDDEN")
  })
})

describe("revokeSession", () => {
  it("revokes another device and logs the event", async () => {
    const { ctx, rows, logger } = createWorld()

    expect(await revoke(ctx, "session-phone")).toEqual({ revoked: true })
    expect(rows.find((row) => row.id === "session-phone")?.revokedAt).toEqual(NOW)
    expect(rows.find((row) => row.id === "session-current")?.revokedAt).toBeNull()
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: "session.revoked", data: expect.objectContaining({ reason: "user_revoke" }) })
    )
  })

  it("refuses the current session with CONFLICT: it is closed by logging out", async () => {
    const { ctx, rows } = createWorld()

    expect(await codeOf(revoke(ctx, "session-current"))).toBe("CONFLICT")
    expect(rows.find((row) => row.id === "session-current")?.revokedAt).toBeNull()
  })

  it("answers NOT_FOUND for an already revoked, unknown or foreign session", async () => {
    const { ctx } = createWorld({
      sessions: [session(), session({ id: "session-revoked", revokedAt: subDays(NOW, 1) })]
    })

    expect(await codeOf(revoke(ctx, "session-revoked"))).toBe("NOT_FOUND")
    expect(await codeOf(revoke(ctx, "session-missing"))).toBe("NOT_FOUND")

    const foreign = createWorld({ sessions: [session(), session({ id: "session-other", userId: "user-2" })] })
    expect(await codeOf(revoke(foreign.ctx, "session-other"))).toBe("NOT_FOUND")
    expect(foreign.rows.find((row) => row.id === "session-other")?.revokedAt).toBeNull()
  })
})

describe("revokeAllSessions", () => {
  it("keeps the current session and reports how many were closed", async () => {
    const { ctx, rows, logger } = createWorld({
      sessions: [session(), session({ id: "session-phone" }), session({ id: "session-tablet" })]
    })

    expect(await revokeAll(ctx)).toEqual({ revokedCount: 2 })
    expect(rows.filter((row) => row.revokedAt === null).map((row) => row.id)).toEqual(["session-current"])
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "session.revoked",
        data: expect.objectContaining({ reason: "user_revoke_all", revokedCount: 2 })
      })
    )
  })

  it("counts nothing when the account has no other device", async () => {
    const { ctx } = createWorld({ sessions: [session()] })

    expect(await revokeAll(ctx)).toEqual({ revokedCount: 0 })
  })

  it("leaves already revoked and expired rows out of the count", async () => {
    const { ctx } = createWorld({
      sessions: [
        session(),
        session({ id: "session-revoked", revokedAt: subDays(NOW, 1) }),
        session({ id: "session-expired", expiresAt: subDays(NOW, 1) }),
        session({ id: "session-phone" })
      ]
    })

    expect(await revokeAll(ctx)).toEqual({ revokedCount: 1 })
  })
})

describe("user-agent classes", () => {
  it.each([
    [CHROME_DESKTOP, "desktop", "chrome"],
    [SAFARI_PHONE, "mobile", "safari"],
    [
      "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/604.1",
      "tablet",
      "safari"
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36",
      "mobile",
      "chrome"
    ],
    ["Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36", "tablet", "chrome"],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
      "desktop",
      "edge"
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36 OPR/120.0.0.0",
      "desktop",
      "opera"
    ],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0", "desktop", "firefox"],
    ["curl/8.7.1", "unknown", "other"]
  ])("classifies %s", (userAgent, device, browser) => {
    expect(classifyDevice(userAgent)).toBe(device)
    expect(classifyBrowser(userAgent)).toBe(browser)
  })

  it("falls back to unknown when the agent was not recorded", () => {
    expect(classifyDevice(null)).toBe("unknown")
    expect(classifyBrowser(null)).toBe("unknown")
  })
})
