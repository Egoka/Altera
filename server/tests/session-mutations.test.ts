import { addDays, subDays } from "date-fns"
import jwt from "jsonwebtoken"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { hashOpaqueToken } from "../src/auth/token-hash"
import { startSession, type SessionClient, type SessionRow } from "../src/auth/session"

const ACCESS_SECRET = "t023-test-access-secret"

interface StoredSession extends SessionRow {
  lastUsedAt: Date
  userAgent: string | null
  ip: string | null
}

function createSessionStore() {
  const rows = new Map<string, StoredSession>()
  let created = 0

  const client: SessionClient = {
    session: {
      async create({ data }) {
        created += 1
        const row: StoredSession = {
          id: `session-${created}`,
          userId: data.userId,
          tokenHash: data.tokenHash ?? "",
          previousTokenHash: data.previousTokenHash ?? null,
          expiresAt: data.expiresAt ?? new Date(),
          revokedAt: data.revokedAt ?? null,
          lastUsedAt: data.lastUsedAt ?? new Date(),
          userAgent: data.userAgent ?? null,
          ip: data.ip ?? null
        }
        rows.set(row.id, row)
        return row
      },
      async findUnique({ where }) {
        return [...rows.values()].find((row) => row.tokenHash === where.tokenHash) ?? null
      },
      async findFirst({ where }) {
        return [...rows.values()].find((row) => row.previousTokenHash === where.previousTokenHash) ?? null
      },
      async update({ where, data }) {
        const row = rows.get(where.id)
        if (!row) throw new Error(`Unknown session ${where.id}`)
        Object.assign(row, data)
        return row
      },
      async updateMany({ where, data }) {
        let count = 0
        for (const row of rows.values()) {
          if (where.userId && row.userId !== where.userId) continue
          if (where.id && row.id !== where.id) continue
          if (row.revokedAt !== null) continue
          Object.assign(row, data)
          count += 1
        }
        return { count }
      }
    }
  }

  return { client, rows }
}

// Читатель с закончившимся базовым авторством: журнал #55 — сессия остаётся валидной.
const reader = {
  id: "user-1",
  role: "reader",
  handle: "reader",
  planTier: "free",
  planUntil: subDays(new Date(), 1),
  archivedAt: null
}

let resolver: {
  Mutation: Record<string, (parent: unknown, args: never, ctx: never) => Promise<unknown>>
}
let store: ReturnType<typeof createSessionStore>
let logger: { log: ReturnType<typeof vi.fn> }
let magicLinkToken: {
  id: string
  tokenHash: string
  usedAt: Date | null
  expiresAt: Date
  user: typeof reader
} | null

beforeAll(async () => {
  vi.stubEnv("JWT_ACCESS_SECRET", ACCESS_SECRET)
  resolver = (await import("../src/graphql/auth/resolver")).default as never
})

beforeEach(() => {
  store = createSessionStore()
  logger = { log: vi.fn() }
  magicLinkToken = null
})

const context = (overrides: Record<string, unknown> = {}) =>
  ({
    prisma: {
      ...store.client,
      user: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === reader.id ? reader : null) },
      magicLinkToken: {
        findUnique: async () => magicLinkToken,
        update: async () => magicLinkToken
      }
    },
    currentUser: null,
    sessionId: null,
    requestMeta: { userAgent: "Chrome", ip: "203.0.113.10" },
    requestId: "11111111-1111-4111-8111-111111111111",
    logger,
    ...overrides
  }) as never

const loggedEvents = () => logger.log.mock.calls.map(([entry]) => entry.event)
const activeSessions = () => [...store.rows.values()].filter((row) => row.revokedAt === null)

describe("verifyMagicLink", () => {
  it("starts a stored session and puts its id into the access token", async () => {
    const token = "a".repeat(64)
    magicLinkToken = {
      id: "magic-1",
      tokenHash: hashOpaqueToken(token),
      usedAt: null,
      expiresAt: addDays(new Date(), 1),
      user: reader
    }

    const payload = (await resolver.Mutation.verifyMagicLink!(null, { token } as never, context())) as {
      accessToken: string
      refreshToken: string
    }

    const session = [...store.rows.values()][0]!
    expect(session).toMatchObject({ userId: reader.id, tokenHash: hashOpaqueToken(payload.refreshToken) })
    expect(jwt.verify(payload.accessToken, ACCESS_SECRET)).toMatchObject({ userId: reader.id, sid: session.id })
    expect(jwt.verify(payload.accessToken, ACCESS_SECRET)).not.toHaveProperty("role")
    expect(loggedEvents()).toContain("auth.login")
  })
})

describe("refreshSession", () => {
  it("rotates the session of a user whose paid period already ended", async () => {
    const started = await startSession(store.client, reader.id, { userAgent: null, ip: null })

    const payload = (await resolver.Mutation.refreshSession!(
      null,
      { refreshToken: started.refreshToken } as never,
      context()
    )) as { accessToken: string; refreshToken: string }

    expect(payload.refreshToken).not.toBe(started.refreshToken)
    expect(jwt.verify(payload.accessToken, ACCESS_SECRET)).toMatchObject({ sid: started.session.id })
    expect(activeSessions()).toHaveLength(1)
    expect(loggedEvents()).toContain("session.refresh")
  })

  it("revokes every session and reports reuse when a rotated token comes back", async () => {
    const first = await startSession(store.client, reader.id, { userAgent: null, ip: null })
    await startSession(store.client, reader.id, { userAgent: null, ip: null })
    await resolver.Mutation.refreshSession!(null, { refreshToken: first.refreshToken } as never, context())

    await expect(
      resolver.Mutation.refreshSession!(null, { refreshToken: first.refreshToken } as never, context())
    ).rejects.toMatchObject({ extensions: { code: "UNAUTHENTICATED" } })

    expect(activeSessions()).toHaveLength(0)
    expect(loggedEvents()).toEqual(["session.refresh", "session.reuse_detected", "session.revoked"])
  })

  it.each([
    ["an unknown token", "0".repeat(64)],
    ["an empty token", ""]
  ])("rejects %s without revoking anything", async (_name, presented) => {
    const started = await startSession(store.client, reader.id, { userAgent: null, ip: null })

    await expect(
      resolver.Mutation.refreshSession!(null, { refreshToken: presented } as never, context())
    ).rejects.toMatchObject({ extensions: { code: "UNAUTHENTICATED" } })

    expect(store.rows.get(started.session.id)?.revokedAt).toBeNull()
  })
})

describe("logout", () => {
  it("revokes the session carried by the access token", async () => {
    const started = await startSession(store.client, reader.id, { userAgent: null, ip: null })
    const other = await startSession(store.client, reader.id, { userAgent: null, ip: null })

    const result = await resolver.Mutation.logout!(
      null,
      {} as never,
      context({ currentUser: reader, sessionId: started.session.id })
    )

    expect(result).toBe(true)
    expect(store.rows.get(started.session.id)?.revokedAt).toBeInstanceOf(Date)
    expect(store.rows.get(other.session.id)?.revokedAt).toBeNull()
    expect(loggedEvents()).toContain("session.revoked")
  })

  it("falls back to the refresh token supplied by the BFF cookie", async () => {
    const started = await startSession(store.client, reader.id, { userAgent: null, ip: null })

    await resolver.Mutation.logout!(null, { refreshToken: started.refreshToken } as never, context())

    expect(store.rows.get(started.session.id)?.revokedAt).toBeInstanceOf(Date)
  })

  it("rejects a request without a session or a refresh token", async () => {
    await expect(resolver.Mutation.logout!(null, {} as never, context())).rejects.toMatchObject({
      extensions: { code: "UNAUTHENTICATED" }
    })
  })
})

describe("logoutAll", () => {
  it("leaves no active session, including the current one", async () => {
    const current = await startSession(store.client, reader.id, { userAgent: null, ip: null })
    await startSession(store.client, reader.id, { userAgent: null, ip: null })
    await startSession(store.client, "user-2", { userAgent: null, ip: null })

    const result = await resolver.Mutation.logoutAll!(
      null,
      {} as never,
      context({ currentUser: reader, sessionId: current.session.id })
    )

    expect(result).toBe(true)
    expect(activeSessions().map((row) => row.userId)).toEqual(["user-2"])
    expect(loggedEvents()).toContain("session.revoked")
  })

  it("rejects an unauthenticated request", async () => {
    await expect(resolver.Mutation.logoutAll!(null, {} as never, context())).rejects.toMatchObject({
      extensions: { code: "UNAUTHENTICATED" }
    })
  })
})
