import crypto from "node:crypto"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { changeUserHandle, createUserWithReservedHandle } from "../src/auth/handle"

let authMutations: typeof import("../src/graphql/auth/resolver").default.Mutation

beforeAll(async () => {
  vi.stubEnv("JWT_ACCESS_SECRET", "test-access-secret")
  ;({ Mutation: authMutations } = (await import("../src/graphql/auth/resolver")).default)
})

beforeEach(() => {
  vi.restoreAllMocks()
})

const uniqueError = (target: string[]) => ({
  code: "P2002",
  meta: { modelName: target.includes("handle") ? "HandleHistory" : "User", target }
})

// Регистрация завершается при обмене ссылки (session-lifecycle.md п. 2), поэтому хэндл
// выделяется в verifyMagicLink по действующей записи токена.
const linkRecord = (email: string, locale: "ru" | "en") => ({
  id: "token-1",
  tokenHash: "c".repeat(64),
  email,
  locale,
  next: null,
  termsVersion: null,
  privacyVersion: null,
  expiresAt: new Date(Date.now() + 10 * 60_000),
  usedAt: null
})

const context = (
  overrides: Record<string, unknown> = {},
  email = "reader@example.test",
  locale: "ru" | "en" = "ru"
) => ({
  prisma: {
    legalText: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    userLegalConsent: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue({}) },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
    session: { create: vi.fn().mockResolvedValue({ id: "session-1" }) },
    magicLinkToken: {
      findUnique: vi.fn().mockResolvedValue(linkRecord(email, locale)),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({})
    },
    ...overrides
  },
  logger: { log: vi.fn() },
  piiHasher: { email: vi.fn().mockReturnValue("email-hash") },
  requestId: "request-1",
  mail: { send: vi.fn().mockResolvedValue({ mailId: "mail-1", messageId: "fake-1" }) }
})

describe("profile handle allocation", () => {
  it("normalizes, reserves, and assigns a changed handle in one transaction", async () => {
    const reserve = vi.fn().mockResolvedValue({})
    const updateUser = vi.fn().mockResolvedValue({ id: "user-1", handle: "new-handle" })
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({ handleHistory: { create: reserve }, user: { update: updateUser } })
    )

    await expect(
      changeUserHandle({ $transaction: transaction } as never, {
        userId: "user-1",
        handle: "  NEW-HANDLE  ",
        requestId: "request-1"
      })
    ).resolves.toEqual({ id: "user-1", handle: "new-handle" })
    expect(reserve).toHaveBeenCalledWith({ data: { handle: "new-handle", userId: "user-1" } })
    expect(updateUser).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { handle: "new-handle" } })
  })

  it.each(["same owner's historical handle", "another owner's reserved handle"])(
    "returns CONFLICT for %s",
    async () => {
      const transaction = vi.fn().mockRejectedValue(uniqueError(["handle"]))

      await expect(
        changeUserHandle({ $transaction: transaction } as never, {
          userId: "user-1",
          handle: "reserved-handle",
          requestId: "request-1"
        })
      ).rejects.toMatchObject({ extensions: { code: "CONFLICT", entity: "handle" } })
    }
  )

  it("rejects an invalid changed handle before opening a transaction", async () => {
    const transaction = vi.fn()

    await expect(
      changeUserHandle({ $transaction: transaction } as never, {
        userId: "user-1",
        handle: "not valid!",
        requestId: "request-1"
      })
    ).rejects.toMatchObject({ extensions: { code: "VALIDATION_ERROR", field: "handle" } })
    expect(transaction).not.toHaveBeenCalled()
  })

  it("does not retry a unique conflict outside the handle registry", async () => {
    const emailConflict = uniqueError(["email"])
    const prisma = { $transaction: vi.fn().mockRejectedValue(emailConflict) }

    await expect(
      createUserWithReservedHandle(prisma as never, {
        email: "reader@example.test",
        name: "Reader",
        locale: "ru"
      })
    ).rejects.toBe(emailConflict)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it("retries a reserved random handle and completes registration on link exchange", async () => {
    const candidates = [Buffer.from("11111111", "hex"), Buffer.from("22222222", "hex")]
    vi.spyOn(crypto, "randomBytes").mockImplementation(((size: number) => {
      if (size === 4) return candidates.shift() ?? Buffer.from("33333333", "hex")
      return Buffer.alloc(size, 0xab)
    }) as typeof crypto.randomBytes)

    const reserve = vi
      .fn()
      .mockRejectedValueOnce(uniqueError(["handle"]))
      .mockResolvedValue({})
    const createUser = vi.fn().mockResolvedValue({
      id: "user-1",
      email: "reader@example.test",
      name: "reader",
      handle: "u-22222222",
      locale: "en"
    })
    const assignOwner = vi.fn().mockResolvedValue({})
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        handleHistory: { create: reserve, update: assignOwner },
        user: { create: createUser }
      })
    )
    const ctx = context(
      {
        user: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockRejectedValue(uniqueError(["handle"]))
        },
        $transaction: transaction
      },
      "reader@example.test",
      "en"
    )

    await expect(authMutations.verifyMagicLink(null, { token: "plain-token" }, ctx as never)).resolves.toMatchObject({
      outcome: "authenticated",
      isNewAccount: true
    })

    expect(reserve).toHaveBeenCalledTimes(2)
    expect(createUser).toHaveBeenCalledWith({
      data: {
        email: "reader@example.test",
        name: "reader",
        handle: "u-22222222",
        locale: "en"
      }
    })
    expect(assignOwner).toHaveBeenCalledWith({
      where: { handle: "u-22222222" },
      data: { userId: "user-1" }
    })
  })

  it("continues with the existing user when concurrent registration wins the email", async () => {
    const existingUser = {
      id: "user-existing",
      email: "reader@example.test",
      locale: "ru",
      archivedAt: null,
      archiveMode: null
    }
    const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(existingUser)
    const transaction = vi.fn().mockRejectedValue(uniqueError(["email"]))
    const ctx = context({
      $transaction: transaction,
      user: { findUnique, create: vi.fn().mockRejectedValue(uniqueError(["email"])) }
    })

    await expect(authMutations.verifyMagicLink(null, { token: "plain-token" }, ctx as never)).resolves.toMatchObject({
      outcome: "authenticated",
      isNewAccount: false
    })

    expect(findUnique).toHaveBeenCalledTimes(2)
    expect(ctx.prisma.session.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "user-existing" }) })
    )
  })
})
