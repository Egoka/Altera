import { addDays, subDays, subMinutes } from "date-fns"
import { beforeEach, describe, expect, it } from "vitest"
import { hashOpaqueToken } from "../src/auth/token-hash"
import {
  SESSION_TTL_DAYS,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  startSession,
  type SessionClient,
  type SessionRow
} from "../src/auth/session"

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

const meta = { userAgent: "Chrome", ip: "203.0.113.10" }
let store: ReturnType<typeof createSessionStore>

beforeEach(() => {
  store = createSessionStore()
})

describe("startSession", () => {
  it("stores only the hash of an opaque refresh token", async () => {
    const now = new Date("2026-09-20T10:00:00.000Z")

    const { session, refreshToken } = await startSession(store.client, "user-1", meta, now)

    expect(refreshToken).toMatch(/^[0-9a-f]{64}$/)
    expect(session.tokenHash).toBe(hashOpaqueToken(refreshToken))
    expect([...store.rows.values()].map((row) => row.tokenHash)).not.toContain(refreshToken)
    expect(session.expiresAt).toEqual(addDays(now, SESSION_TTL_DAYS))
    expect(store.rows.get(session.id)).toMatchObject({ userAgent: "Chrome", ip: "203.0.113.10" })
  })
})

describe("rotateSession", () => {
  it("rotates the token and keeps the previous hash for reuse detection", async () => {
    const started = await startSession(store.client, "user-1", meta)

    const outcome = await rotateSession(store.client, started.refreshToken, meta)

    expect(outcome.status).toBe("rotated")
    if (outcome.status !== "rotated") return
    expect(outcome.refreshToken).not.toBe(started.refreshToken)
    expect(outcome.session.id).toBe(started.session.id)
    expect(outcome.session.tokenHash).toBe(hashOpaqueToken(outcome.refreshToken))
    expect(outcome.session.previousTokenHash).toBe(hashOpaqueToken(started.refreshToken))
  })

  it("revokes every session of the user when a rotated token is presented again", async () => {
    const first = await startSession(store.client, "user-1", meta)
    const second = await startSession(store.client, "user-1", meta)
    const stranger = await startSession(store.client, "user-2", meta)
    await rotateSession(store.client, first.refreshToken, meta)

    const outcome = await rotateSession(store.client, first.refreshToken, meta)

    expect(outcome).toMatchObject({ status: "reuse_detected", userId: "user-1", sessionId: first.session.id })
    expect(store.rows.get(first.session.id)?.revokedAt).toBeInstanceOf(Date)
    expect(store.rows.get(second.session.id)?.revokedAt).toBeInstanceOf(Date)
    expect(store.rows.get(stranger.session.id)?.revokedAt).toBeNull()
  })

  it("reports an expired session without rotating it", async () => {
    const now = new Date("2026-09-20T10:00:00.000Z")
    const started = await startSession(store.client, "user-1", meta, subDays(now, SESSION_TTL_DAYS + 1))

    const outcome = await rotateSession(store.client, started.refreshToken, meta, now)

    expect(outcome).toMatchObject({ status: "expired", sessionId: started.session.id })
    expect(store.rows.get(started.session.id)?.tokenHash).toBe(started.session.tokenHash)
  })

  it("rejects the token of an already revoked session", async () => {
    const started = await startSession(store.client, "user-1", meta)
    await revokeSession(store.client, started.session.id)

    const outcome = await rotateSession(store.client, started.refreshToken, meta)

    expect(outcome).toMatchObject({ status: "revoked", sessionId: started.session.id })
  })

  it("reports an unknown token without touching stored sessions", async () => {
    const started = await startSession(store.client, "user-1", meta)

    const outcome = await rotateSession(store.client, "0".repeat(64), meta)

    expect(outcome).toEqual({ status: "unknown" })
    expect(store.rows.get(started.session.id)?.revokedAt).toBeNull()
  })

  it("moves the expiry window forward on every rotation", async () => {
    const now = new Date("2026-09-20T10:00:00.000Z")
    const started = await startSession(store.client, "user-1", meta, subMinutes(now, 30))

    const outcome = await rotateSession(store.client, started.refreshToken, meta, now)

    expect(outcome.status === "rotated" && outcome.session.expiresAt).toEqual(addDays(now, SESSION_TTL_DAYS))
  })
})

describe("revocation", () => {
  it("counts only sessions that were still active", async () => {
    const first = await startSession(store.client, "user-1", meta)
    await startSession(store.client, "user-1", meta)
    await revokeSession(store.client, first.session.id)

    expect(await revokeAllSessions(store.client, "user-1")).toBe(1)
    expect(await revokeAllSessions(store.client, "user-1")).toBe(0)
    expect([...store.rows.values()].every((row) => row.revokedAt !== null)).toBe(true)
  })
})
