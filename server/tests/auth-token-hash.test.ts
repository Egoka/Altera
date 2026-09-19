import crypto from "crypto"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

let authMutations: typeof import("../src/graphql/auth/resolver").default.Mutation

beforeAll(async () => {
  vi.stubEnv("JWT_ACCESS_SECRET", "test-access-secret")
  vi.stubEnv("JWT_REFRESH_SECRET", "test-refresh-secret")
  ;({ Mutation: authMutations } = (await import("../src/graphql/auth/resolver")).default)
})

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("auth token hashes", () => {
  it("hashes opaque tokens as lowercase SHA-256 hex", async () => {
    const { hashOpaqueToken } = await import("../src/auth/token-hash")

    const hash = hashOpaqueToken("plain-magic-token")

    expect(hash).toBe("b8327fe9fd1b3d80691871fdc042e4fcfbfd9524d67e3b7d5ba205d6df83c78b")
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("separates email-change code hashes by secret and domain", async () => {
    const { hashEmailChangeCode } = await import("../src/auth/token-hash")

    expect(hashEmailChangeCode("123456", "secret-a")).toBe(
      "a404ccd373485c6a9c50a02863fa9b44208058f70541a53984327e283134de45"
    )
    expect(hashEmailChangeCode("123456", "secret-b")).toBe(
      "da0536625aede1353cca7d6acb5e1813328a63cc44f7371194a2a6cf11ec61f5"
    )
  })

  it("compares only well-formed SHA-256 hex hashes", async () => {
    const { equalHexHashes } = await import("../src/auth/token-hash")
    const hash = "b8327fe9fd1b3d80691871fdc042e4fcfbfd9524d67e3b7d5ba205d6df83c78b"

    expect(equalHexHashes(hash, hash)).toBe(true)
    expect(equalHexHashes(hash, `${hash.slice(0, -1)}0`)).toBe(false)
    expect(equalHexHashes("abc", hash)).toBe(false)
    expect(equalHexHashes(hash.toUpperCase(), hash)).toBe(false)
    expect(equalHexHashes("g".repeat(64), hash)).toBe(false)
  })
})

describe("magic-link persistence", () => {
  it("stores only the hash of a newly generated magic-link token", async () => {
    const tokenBytes = Buffer.alloc(32, 0xab)
    vi.spyOn(crypto, "randomBytes").mockReturnValue(tokenBytes)
    const upsert = vi.fn().mockResolvedValue({})
    const ctx = {
      prisma: {
        user: { findUnique: vi.fn().mockResolvedValue({ id: "user-1" }) },
        magicLinkToken: { upsert }
      },
      logger: { log: vi.fn() },
      piiHasher: { email: vi.fn().mockReturnValue("email-hash") },
      requestId: "request-1",
      mail: { send: vi.fn().mockResolvedValue({ mailId: "mail-1", messageId: "fake-1" }) }
    } as never

    await authMutations.requestMagicLink(null, { email: "reader@example.test", locale: "ru" }, ctx)

    const payload = upsert.mock.calls[0][0]
    const expectedHash = "271a413bd339c5709fdceaec41f14f11e9fbfb5042d72d331c65f32b284cd09a"
    expect(payload.update.tokenHash).toBe(expectedHash)
    expect(payload.create.tokenHash).toBe(expectedHash)
    expect(payload.update).not.toHaveProperty("token")
    expect(payload.create).not.toHaveProperty("token")
    expect(JSON.stringify(payload)).not.toContain(tokenBytes.toString("hex"))
  })

  it("queries a magic link by hash without sending plaintext to Prisma", async () => {
    const findUnique = vi.fn().mockResolvedValue(null)
    const ctx = {
      prisma: { magicLinkToken: { findUnique } },
      requestId: "request-2"
    } as never

    await expect(authMutations.verifyMagicLink(null, { token: "plain-magic-token" }, ctx)).rejects.toMatchObject({
      extensions: { code: "NOT_FOUND" }
    })

    expect(findUnique).toHaveBeenCalledWith({
      where: { tokenHash: "b8327fe9fd1b3d80691871fdc042e4fcfbfd9524d67e3b7d5ba205d6df83c78b" },
      include: { user: true }
    })
    expect(JSON.stringify(findUnique.mock.calls)).not.toContain("plain-magic-token")
  })
})
