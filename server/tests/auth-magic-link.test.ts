import { beforeAll, describe, expect, it, vi } from "vitest"
import { sanitizeNextPath } from "../src/auth/next-path"
import { createTestRateLimiter } from "./helpers/rate-limit"

// Резолвер импортируется динамически: он читает секреты из env на уровне модуля.
let resolver: typeof import("../src/graphql/auth/resolver").default

beforeAll(async () => {
  vi.stubEnv("JWT_ACCESS_SECRET", "t022-test-access-secret")
  vi.stubEnv("JWT_REFRESH_SECRET", "t022-test-refresh-secret")
  vi.stubEnv("MAGIC_LINK_BASE_URL", "http://127.0.0.1:4173/auth/verify")
  resolver = (await import("../src/graphql/auth/resolver")).default
})

interface FakeUser {
  id: string
  email: string
  name: string
  handle: string
  locale: "ru" | "en"
  archivedAt: Date | null
  archiveMode: "self" | "admin" | "emergency" | null
}

interface FakeToken {
  id: string
  tokenHash: string
  email: string
  locale: "ru" | "en"
  next: string | null
  termsVersion: number | null
  privacyVersion: number | null
  expiresAt: Date
  usedAt: Date | null
}

interface WorldOptions {
  users?: FakeUser[]
  tokens?: FakeToken[]
  publishedTerms?: number | null
  publishedPrivacy?: number | null
  acceptedTerms?: number | null
  acceptedPrivacy?: number | null
  mailFails?: boolean
}

function createWorld(options: WorldOptions = {}) {
  const users = [...(options.users ?? [])]
  const tokens = [...(options.tokens ?? [])]
  const sessions: { userId: string; tokenHash: string; limited: boolean }[] = []
  const consents: { userId: string; legalTextId: string }[] = []
  const logs: { event: string; level: string; data?: Record<string, unknown> }[] = []
  const sentMail: { to: string; subject: string; text: string }[] = []

  const legalTexts = [
    ...(options.publishedTerms === null || options.publishedTerms === undefined
      ? []
      : [{ id: "terms-current", kind: "terms", locale: "ru", version: options.publishedTerms, status: "published" }]),
    ...(options.publishedPrivacy === null || options.publishedPrivacy === undefined
      ? []
      : [
          {
            id: "privacy-current",
            kind: "privacy",
            locale: "ru",
            version: options.publishedPrivacy,
            status: "published"
          }
        ])
  ]

  const acceptedTexts = [
    ...(options.acceptedTerms === null || options.acceptedTerms === undefined
      ? []
      : [{ legalText: { kind: "terms", version: options.acceptedTerms } }]),
    ...(options.acceptedPrivacy === null || options.acceptedPrivacy === undefined
      ? []
      : [{ legalText: { kind: "privacy", version: options.acceptedPrivacy } }])
  ]

  const prisma = {
    legalText: {
      findFirst: vi.fn(async ({ where }: { where: { kind: string; locale: string; status: string } }) =>
        legalTexts.find(
          (text) => text.kind === where.kind && text.locale === where.locale && text.status === where.status
        )
      ),
      findMany: vi.fn(async () => legalTexts.map(({ id }) => ({ id })))
    },
    userLegalConsent: {
      findMany: vi.fn(async () => acceptedTexts),
      upsert: vi.fn(async ({ create }: { create: { userId: string; legalTextId: string } }) => {
        consents.push(create)
        return create
      })
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        const found = users.find((user) => user.email === where.email || user.id === where.id)
        return found ?? null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = {
          id: `user-${users.length + 1}`,
          archivedAt: null,
          archiveMode: null,
          ...data
        } as unknown as FakeUser
        users.push(created)
        return created
      })
    },
    handleHistory: { create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
    magicLinkToken: {
      findUnique: vi.fn(
        async ({ where }: { where: { tokenHash: string } }) =>
          tokens.find((token) => token.tokenHash === where.tokenHash) ?? null
      ),
      upsert: vi.fn(async ({ where, create }: { where: { email: string }; create: Record<string, unknown> }) => {
        const index = tokens.findIndex((token) => token.email === where.email)
        const record = { id: `token-${tokens.length + 1}`, ...create } as unknown as FakeToken
        if (index >= 0) tokens.splice(index, 1, record)
        else tokens.push(record)
        return record
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { usedAt: Date } }) => {
        const record = tokens.find((token) => token.id === where.id)
        if (record) record.usedAt = data.usedAt
        return record
      })
    },
    session: {
      create: vi.fn(async ({ data }: { data: { userId: string; tokenHash: string; limited: boolean } }) => {
        sessions.push({ userId: data.userId, tokenHash: data.tokenHash, limited: data.limited })
        return { id: `session-${sessions.length}` }
      })
    },
    $transaction: vi.fn(async (run: (client: any) => unknown) => run(prisma))
  }

  const logger = {
    log: (entry: { event: string; level: string; data?: Record<string, unknown> }) => {
      logs.push({ event: entry.event, level: entry.level, data: entry.data })
    }
  }
  const ctx = {
    prisma,
    requestId: "req-t022",
    logger,
    rateLimiter: createTestRateLimiter({ logger: logger as never }),
    piiHasher: { email: (value: string) => `hash(${value})` },
    mail: {
      send: vi.fn(async (input: { to: string; content: { subject: string; text: string } }) => {
        if (options.mailFails) throw new Error("smtp down")
        sentMail.push({ to: input.to, subject: input.content.subject, text: input.content.text })
        return { mailId: "mail-1", messageId: "<id>" }
      })
    }
  }

  return { ctx, users, tokens, sessions, consents, logs, sentMail }
}

const consent = (termsVersion: number | null, privacyVersion: number | null) => ({ termsVersion, privacyVersion })

describe("requestMagicLink", () => {
  it("answers identically for a known and an unknown address", async () => {
    const known = createWorld({
      users: [
        {
          id: "user-1",
          email: "known@example.test",
          name: "known",
          handle: "u-1",
          locale: "ru",
          archivedAt: null,
          archiveMode: null
        }
      ]
    })
    const unknown = createWorld()

    const knownResult = await resolver.Mutation.requestMagicLink(
      {},
      { email: "known@example.test", consentVersion: consent(null, null), locale: "ru" },
      known.ctx as never
    )
    const unknownResult = await resolver.Mutation.requestMagicLink(
      {},
      { email: "stranger@example.test", consentVersion: consent(null, null), locale: "ru" },
      unknown.ctx as never
    )

    expect(knownResult).toEqual({ ok: true, retryAfterSec: null })
    expect(unknownResult).toEqual(knownResult)
    expect(known.logs.map(({ event }) => event)).toEqual(unknown.logs.map(({ event }) => event))
  })

  it("does not create an account for an unknown address", async () => {
    const world = createWorld()

    await resolver.Mutation.requestMagicLink(
      {},
      { email: "stranger@example.test", consentVersion: consent(null, null), locale: "ru" },
      world.ctx as never
    )

    expect(world.users).toHaveLength(0)
    expect(world.ctx.prisma.user.create).not.toHaveBeenCalled()
    expect(world.tokens).toHaveLength(1)
  })

  it("stores the hash of the emailed token and never the token itself", async () => {
    const world = createWorld()

    await resolver.Mutation.requestMagicLink(
      {},
      { email: "reader@example.test", consentVersion: consent(null, null), locale: "ru" },
      world.ctx as never
    )

    const emailed = world.sentMail[0]!.text.match(/\/auth\/verify\?token=([0-9a-f]{64})/)?.[1]
    expect(emailed).toBeTruthy()
    const stored = world.tokens[0]!
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.tokenHash).not.toBe(emailed)
    expect(JSON.stringify(stored)).not.toContain(emailed!)
  })

  it("replaces the previous token of the same address", async () => {
    const world = createWorld()
    const request = () =>
      resolver.Mutation.requestMagicLink(
        {},
        { email: "reader@example.test", consentVersion: consent(null, null), locale: "ru" },
        world.ctx as never
      )

    await request()
    const first = world.tokens[0]!.tokenHash
    await request()

    expect(world.tokens).toHaveLength(1)
    expect(world.tokens[0]!.tokenHash).not.toBe(first)
    expect(world.tokens[0]!.usedAt).toBeNull()
  })

  it("rejects a malformed address before touching the mail transport", async () => {
    const world = createWorld()

    await expect(
      resolver.Mutation.requestMagicLink(
        {},
        { email: "not-an-address", consentVersion: consent(null, null), locale: "ru" },
        world.ctx as never
      )
    ).rejects.toMatchObject({ extensions: { code: "VALIDATION_ERROR", field: "email" } })
    expect(world.ctx.mail.send).not.toHaveBeenCalled()
  })

  it("rejects consent that does not match the published versions", async () => {
    const world = createWorld({ publishedTerms: 3, publishedPrivacy: 2 })

    await expect(
      resolver.Mutation.requestMagicLink(
        {},
        { email: "reader@example.test", consentVersion: consent(2, 2), locale: "ru" },
        world.ctx as never
      )
    ).rejects.toMatchObject({ extensions: { code: "VALIDATION_ERROR", field: "consentVersion" } })
    expect(world.tokens).toHaveLength(0)
  })

  it("sends the letter in the account locale and keeps the page locale for a new address", async () => {
    const existing = createWorld({
      users: [
        {
          id: "user-1",
          email: "reader@example.test",
          name: "reader",
          handle: "u-1",
          locale: "en",
          archivedAt: null,
          archiveMode: null
        }
      ]
    })
    const fresh = createWorld()

    await resolver.Mutation.requestMagicLink(
      {},
      { email: "reader@example.test", consentVersion: consent(null, null), locale: "ru" },
      existing.ctx as never
    )
    await resolver.Mutation.requestMagicLink(
      {},
      { email: "fresh@example.test", consentVersion: consent(null, null), locale: "ru" },
      fresh.ctx as never
    )

    expect(existing.sentMail[0]!.subject).toBe("Your Altera login link")
    expect(fresh.sentMail[0]!.subject).toBe("Ссылка входа в Altera")
  })

  it("keeps only a relative next path", async () => {
    const world = createWorld()

    await resolver.Mutation.requestMagicLink(
      {},
      {
        email: "reader@example.test",
        consentVersion: consent(null, null),
        locale: "ru",
        next: "https://evil.example/steal"
      },
      world.ctx as never
    )

    expect(world.tokens[0]!.next).toBeNull()
  })

  it("surfaces an unavailable mail provider", async () => {
    const world = createWorld({ mailFails: true })

    await expect(
      resolver.Mutation.requestMagicLink(
        {},
        { email: "reader@example.test", consentVersion: consent(null, null), locale: "ru" },
        world.ctx as never
      )
    ).rejects.toThrow()
  })
})

describe("verifyMagicLink", () => {
  const tokenFor = async (world: ReturnType<typeof createWorld>, email: string, next?: string) => {
    await resolver.Mutation.requestMagicLink(
      {},
      { email, consentVersion: consent(null, null), locale: "ru", next },
      world.ctx as never
    )
    return world.sentMail.at(-1)!.text.match(/\/auth\/verify\?token=([0-9a-f]{64})/)![1]!
  }

  it("creates the account on first login and reports it as new", async () => {
    const world = createWorld()
    const token = await tokenFor(world, "fresh@example.test", "/me/articles")

    const result = await resolver.Mutation.verifyMagicLink({}, { token }, world.ctx as never)

    expect(result.outcome).toBe("authenticated")
    expect(result.isNewAccount).toBe(true)
    expect(result.next).toBe("/me/articles")
    expect(result.session.accessToken).toEqual(expect.any(String))
    expect(world.users).toHaveLength(1)
    expect(world.sessions).toEqual([expect.objectContaining({ limited: false })])
    expect(world.logs.filter(({ event }) => event === "auth.login")).toHaveLength(1)
  })

  it("refuses the same link twice", async () => {
    const world = createWorld()
    const token = await tokenFor(world, "fresh@example.test")

    await resolver.Mutation.verifyMagicLink({}, { token }, world.ctx as never)

    await expect(resolver.Mutation.verifyMagicLink({}, { token }, world.ctx as never)).rejects.toMatchObject({
      extensions: { code: "NOT_FOUND" }
    })
    expect(world.logs.filter(({ event }) => event === "auth.login.failed")).toEqual([
      expect.objectContaining({ data: { reason: "used" } })
    ])
  })

  it("answers an unknown and an expired link the same way", async () => {
    const world = createWorld()
    const expired = createWorld()
    const token = await tokenFor(expired, "fresh@example.test")
    expired.tokens[0]!.expiresAt = new Date(Date.now() - 1_000)

    const unknownFailure = await resolver.Mutation.verifyMagicLink(
      {},
      { token: "a".repeat(64) },
      world.ctx as never
    ).catch((error: { extensions: Record<string, unknown> }) => error.extensions)
    const expiredFailure = await resolver.Mutation.verifyMagicLink({}, { token }, expired.ctx as never).catch(
      (error: { extensions: Record<string, unknown> }) => error.extensions
    )

    expect(unknownFailure).toMatchObject({ code: "NOT_FOUND", entity: "magicLink" })
    expect(expiredFailure).toMatchObject({ code: "NOT_FOUND", entity: "magicLink" })
    expect(expired.logs.at(-1)).toMatchObject({ data: { reason: "expired" } })
  })

  it("opens a limited session for a self-archived account", async () => {
    const world = createWorld({
      users: [
        {
          id: "user-1",
          email: "archived@example.test",
          name: "archived",
          handle: "u-1",
          locale: "ru",
          archivedAt: new Date("2026-09-01T00:00:00.000Z"),
          archiveMode: "self"
        }
      ]
    })
    const token = await tokenFor(world, "archived@example.test")

    const result = await resolver.Mutation.verifyMagicLink({}, { token }, world.ctx as never)

    expect(result.outcome).toBe("archived_self")
    expect(result.session.accessToken).toEqual(expect.any(String))
    expect(world.sessions).toEqual([expect.objectContaining({ limited: true })])
    expect(world.logs.at(-1)).toMatchObject({ event: "auth.login", data: { reason: "archived_self" } })
  })

  it("gives an administratively archived account the appeal token and no session", async () => {
    const world = createWorld({
      users: [
        {
          id: "user-1",
          email: "blocked@example.test",
          name: "blocked",
          handle: "u-1",
          locale: "ru",
          archivedAt: new Date("2026-09-01T00:00:00.000Z"),
          archiveMode: "admin"
        }
      ]
    })
    const token = await tokenFor(world, "blocked@example.test")

    const result = await resolver.Mutation.verifyMagicLink({}, { token }, world.ctx as never)

    expect(result).toMatchObject({ outcome: "archived_admin", session: null, appealToken: token })
    expect(world.sessions).toHaveLength(0)
    expect(world.logs.at(-1)).toMatchObject({ event: "auth.login.failed", data: { reason: "archived_admin" } })
  })

  it("does not create a second account for an archived address", async () => {
    const world = createWorld({
      users: [
        {
          id: "user-1",
          email: "blocked@example.test",
          name: "blocked",
          handle: "u-1",
          locale: "ru",
          archivedAt: new Date("2026-09-01T00:00:00.000Z"),
          archiveMode: "emergency"
        }
      ]
    })
    const token = await tokenFor(world, "blocked@example.test")

    await resolver.Mutation.verifyMagicLink({}, { token }, world.ctx as never)

    expect(world.users).toHaveLength(1)
    expect(world.ctx.prisma.user.create).not.toHaveBeenCalled()
  })

  it("asks for consent again when the published version moved on", async () => {
    const world = createWorld({
      publishedTerms: 4,
      publishedPrivacy: 2,
      acceptedTerms: 3,
      acceptedPrivacy: 2,
      users: [
        {
          id: "user-1",
          email: "reader@example.test",
          name: "reader",
          handle: "u-1",
          locale: "ru",
          archivedAt: null,
          archiveMode: null
        }
      ]
    })
    await resolver.Mutation.requestMagicLink(
      {},
      { email: "reader@example.test", consentVersion: consent(4, 2), locale: "ru" },
      world.ctx as never
    )
    const token = world.sentMail.at(-1)!.text.match(/\/auth\/verify\?token=([0-9a-f]{64})/)![1]!

    const result = await resolver.Mutation.verifyMagicLink({}, { token }, world.ctx as never)

    expect(result).toMatchObject({ outcome: "consent_required", session: null, termsVersion: 4, privacyVersion: 2 })
    expect(world.sessions).toHaveLength(0)
    // Токен не гасится: вход завершает acceptConsent.
    expect(world.tokens[0]!.usedAt).toBeNull()

    const accepted = await resolver.Mutation.acceptConsent(
      {},
      { token, termsVersion: 4, privacyVersion: 2 },
      world.ctx as never
    )

    expect(accepted.outcome).toBe("authenticated")
    expect(world.sessions).toHaveLength(1)
    expect(world.consents).toHaveLength(2)
  })

  it("rejects acceptConsent for versions that are not the published ones", async () => {
    const world = createWorld({
      publishedTerms: 4,
      publishedPrivacy: 2,
      acceptedTerms: 3,
      acceptedPrivacy: 2,
      users: [
        {
          id: "user-1",
          email: "reader@example.test",
          name: "reader",
          handle: "u-1",
          locale: "ru",
          archivedAt: null,
          archiveMode: null
        }
      ]
    })
    await resolver.Mutation.requestMagicLink(
      {},
      { email: "reader@example.test", consentVersion: consent(4, 2), locale: "ru" },
      world.ctx as never
    )
    const token = world.sentMail.at(-1)!.text.match(/\/auth\/verify\?token=([0-9a-f]{64})/)![1]!

    await expect(
      resolver.Mutation.acceptConsent({}, { token, termsVersion: 3, privacyVersion: 2 }, world.ctx as never)
    ).rejects.toMatchObject({ extensions: { code: "VALIDATION_ERROR" } })
  })
})

describe("legalVersions", () => {
  it("reports the published versions and the public paths", async () => {
    const world = createWorld({ publishedTerms: 4, publishedPrivacy: 2 })

    await expect(resolver.Query.legalVersions({}, { locale: "ru" }, world.ctx as never)).resolves.toEqual({
      termsVersion: 4,
      privacyVersion: 2,
      termsPath: "/legal/terms",
      privacyPath: "/legal/privacy"
    })
  })

  it("reports null versions while no legal text is published", async () => {
    const world = createWorld()

    await expect(resolver.Query.legalVersions({}, { locale: "ru" }, world.ctx as never)).resolves.toMatchObject({
      termsVersion: null,
      privacyVersion: null
    })
  })
})

describe("sanitizeNextPath", () => {
  it.each(["/me", "/me/articles?tab=draft", "/en/login"])("keeps the relative path %s", (value) => {
    expect(sanitizeNextPath(value)).toBe(value)
  })

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "me", "", "/me\nSet-Cookie: x"])(
    "drops %j",
    (value) => {
      expect(sanitizeNextPath(value)).toBeNull()
    }
  )
})

describe("magic link token lifetime", () => {
  it("expires the emailed link fifteen minutes after the request", async () => {
    const world = createWorld()
    const before = Date.now()

    await resolver.Mutation.requestMagicLink(
      {},
      { email: "reader@example.test", consentVersion: consent(null, null), locale: "ru" },
      world.ctx as never
    )

    const lifetimeMs = world.tokens[0]!.expiresAt.getTime() - before
    expect(lifetimeMs).toBeGreaterThan(14 * 60_000)
    expect(lifetimeMs).toBeLessThanOrEqual(15 * 60_000 + 1_000)
  })
})
