import { beforeEach, describe, expect, it, vi } from "vitest"
import resolver from "../src/graphql/email-change/resolver"
import { EMAIL_CHANGE_CODE_ATTEMPTS } from "../src/auth/email-change"
import { maskEmail } from "../src/auth/email-address"
import { hashEmailChangeCode } from "../src/auth/token-hash"
import { createTestRateLimiter } from "./helpers/rate-limit"

/**
 * Смена адреса по коду (журнал §25.8, `30-account/reader/email-change.md`). Главная проверка
 * задачи — AC-1: ни одна ветка не отзывает сессии, поэтому двойник хранит их отдельно и
 * тесты сверяют список после смены.
 */

const CODE_SECRET = "t032-test-code-secret"
const NOW = new Date("2026-09-21T10:00:00.000Z")

interface FakeUser {
  id: string
  email: string
  role: "reader" | "author" | "admin" | "owner"
  locale: "ru" | "en"
  archivedAt: Date | null
  planTier: "free" | "standard" | "pro"
  planUntil: Date | null
}

interface FakeRequest {
  userId: string
  newEmail: string
  codeHash: string
  expiresAt: Date
  attempts: number
}

const reader = (overrides: Partial<FakeUser> = {}): FakeUser => ({
  id: "user-1",
  email: "reader@example.test",
  role: "reader",
  locale: "ru",
  archivedAt: null,
  planTier: "free",
  planUntil: null,
  ...overrides
})

interface WorldOptions {
  users?: FakeUser[]
  currentUser?: FakeUser | null
  request?: FakeRequest | null
  noticeFails?: boolean
  now?: () => Date
}

function createWorld(options: WorldOptions = {}) {
  const current = options.currentUser === undefined ? reader() : options.currentUser
  const users = [...(options.users ?? (current ? [current] : []))]
  // Сессии заводятся заранее и ни одним резолвером не трогаются: AC-1 проверяет именно это.
  const sessions = [
    { id: "session-desktop", userId: "user-1", revokedAt: null },
    { id: "session-phone", userId: "user-1", revokedAt: null }
  ]
  let request: FakeRequest | null = options.request ?? null
  const audit: Record<string, unknown>[] = []
  const sentMail: { to: string; template: string; subject: string; text: string; sanitizedBody: string }[] = []

  const emailChangeRequest = {
    findUnique: vi.fn(async ({ where }: { where: { userId: string } }) =>
      request && request.userId === where.userId ? { id: "request-1", createdAt: NOW, ...request } : null
    ),
    upsert: vi.fn(async ({ where, update, create }: { where: { userId: string }; update: any; create: any }) => {
      request = request && request.userId === where.userId ? { ...request, ...update } : { ...create }
      return { id: "request-1", createdAt: NOW, ...request }
    }),
    update: vi.fn(async ({ data }: { data: Partial<FakeRequest> }) => {
      request = { ...(request as FakeRequest), ...data }
      return { id: "request-1", createdAt: NOW, ...request }
    }),
    deleteMany: vi.fn(async () => {
      const deleted = request ? 1 : 0
      request = null
      return { count: deleted }
    })
  }

  const prisma = {
    emailChangeRequest,
    user: {
      findUnique: vi.fn(
        async ({ where }: { where: { email?: string; id?: string } }) =>
          users.find((user) => user.email === where.email || user.id === where.id) ?? null
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { email: string } }) => {
        const found = users.find((user) => user.id === where.id)
        if (found) found.email = data.email
        return found
      })
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        audit.push(data)
        return data
      })
    },
    session: {
      findMany: vi.fn(async () => sessions),
      updateMany: vi.fn(async () => ({ count: 0 }))
    },
    $transaction: vi.fn(async (run: (client: unknown) => unknown) => run(prisma))
  }

  const ctx = {
    prisma,
    currentUser: current,
    requestId: "req-t032",
    requestMeta: { ip: "127.0.0.1", userAgent: null },
    logger: { log: () => undefined },
    rateLimiter: createTestRateLimiter({ now: options.now }),
    mail: {
      send: vi.fn(async (input: any) => {
        if (options.noticeFails && input.template === "email_change_notice") throw new Error("smtp down")
        sentMail.push({
          to: input.to,
          template: input.template,
          subject: input.content.subject,
          text: input.content.text,
          sanitizedBody: input.sanitizedBody
        })
        return { mailId: "mail-1", messageId: "<id>" }
      })
    }
  }

  return { ctx, users, sessions, audit, sentMail, currentRequest: () => request }
}

const codeFrom = (text: string): string => {
  const code = text.match(/\b(\d{6})\b/)?.[1]
  if (!code) throw new Error("the code letter carries no code")
  return code
}

const pendingRequest = (overrides: Partial<FakeRequest> = {}): FakeRequest => ({
  userId: "user-1",
  newEmail: "new@example.test",
  codeHash: hashEmailChangeCode("123456", CODE_SECRET),
  expiresAt: new Date(NOW.getTime() + 15 * 60_000),
  attempts: 0,
  ...overrides
})

const errorCode = (error: unknown): string => (error as { extensions: { code: string } }).extensions.code

const failure = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
  } catch (error: unknown) {
    return errorCode(error)
  }
  throw new Error("the call was expected to fail")
}

beforeEach(() => {
  vi.stubEnv("EMAIL_CHANGE_CODE_SECRET", CODE_SECRET)
  vi.stubEnv("MAGIC_LINK_EXPIRY_MINUTES", "15")
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  return () => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  }
})

describe("AccountUser.emailChange", () => {
  it("shows the current address masked and no open request", async () => {
    const world = createWorld()

    const state = await resolver.AccountUser.emailChange({ id: "user-1" }, {}, world.ctx as never)

    expect(state).toEqual({ currentEmailMasked: "r•••@example.test", pending: null })
    expect(state.currentEmailMasked).not.toContain("reader@")
  })

  it("keeps showing an expired request so the screen can offer a new code", async () => {
    const world = createWorld({ request: pendingRequest({ expiresAt: new Date(NOW.getTime() - 1000), attempts: 3 }) })

    const state = await resolver.AccountUser.emailChange({ id: "user-1" }, {}, world.ctx as never)

    expect(state.pending).toEqual({
      newEmailMasked: "n•••@example.test",
      expiresAt: new Date(NOW.getTime() - 1000).toISOString(),
      attemptsLeft: EMAIL_CHANGE_CODE_ATTEMPTS - 3
    })
  })

  it("answers UNAUTHENTICATED without a session and FORBIDDEN for somebody else's record", async () => {
    const guest = createWorld({ currentUser: null, users: [reader()] })
    const stranger = createWorld()

    expect(await failure(() => resolver.AccountUser.emailChange({ id: "user-1" }, {}, guest.ctx as never))).toBe(
      "UNAUTHENTICATED"
    )
    expect(await failure(() => resolver.AccountUser.emailChange({ id: "user-2" }, {}, stranger.ctx as never))).toBe(
      "FORBIDDEN"
    )
  })

  it("refuses an archived account: a limited session only sees its own state screen", async () => {
    const world = createWorld({ currentUser: reader({ archivedAt: NOW }) })

    expect(await failure(() => resolver.AccountUser.emailChange({ id: "user-1" }, {}, world.ctx as never))).toBe(
      "FORBIDDEN"
    )
  })
})

describe("requestEmailChange", () => {
  it("mails the code to the new address and stores only its hash", async () => {
    const world = createWorld()

    const state = await resolver.Mutation.requestEmailChange({}, { newEmail: " New@Example.test " }, world.ctx as never)

    expect(state.pending).toMatchObject({
      newEmailMasked: "n•••@example.test",
      attemptsLeft: EMAIL_CHANGE_CODE_ATTEMPTS
    })
    expect(world.sentMail).toHaveLength(1)
    expect(world.sentMail[0]).toMatchObject({ to: "new@example.test", template: "email_change_code" })

    const code = codeFrom(world.sentMail[0]!.text)
    expect(world.currentRequest()).toMatchObject({
      newEmail: "new@example.test",
      codeHash: hashEmailChangeCode(code, CODE_SECRET)
    })
    // Копия письма в истории не хранит кода (журнал §27.6).
    expect(world.sentMail[0]!.sanitizedBody).not.toContain(code)
    // Адрес аккаунта до подтверждения не меняется.
    expect(world.users[0]!.email).toBe("reader@example.test")
  })

  it("rejects a malformed address and the current one", async () => {
    const malformed = createWorld()
    const same = createWorld()

    expect(
      await failure(() =>
        resolver.Mutation.requestEmailChange({}, { newEmail: "not-an-address" }, malformed.ctx as never)
      )
    ).toBe("VALIDATION_ERROR")
    expect(
      await failure(() =>
        resolver.Mutation.requestEmailChange({}, { newEmail: "READER@example.test" }, same.ctx as never)
      )
    ).toBe("VALIDATION_ERROR")
    expect(malformed.sentMail).toHaveLength(0)
    expect(same.sentMail).toHaveLength(0)
  })

  it("reports CONFLICT when another address is already waiting for its code", async () => {
    const world = createWorld({ request: pendingRequest() })

    expect(
      await failure(() =>
        resolver.Mutation.requestEmailChange({}, { newEmail: "third@example.test" }, world.ctx as never)
      )
    ).toBe("CONFLICT")
    expect(world.currentRequest()).toMatchObject({ newEmail: "new@example.test" })
  })

  it("resends the code to the same address and invalidates the previous one", async () => {
    const world = createWorld({ request: pendingRequest() })

    await resolver.Mutation.requestEmailChange({}, { newEmail: "new@example.test" }, world.ctx as never)

    const resent = codeFrom(world.sentMail[0]!.text)
    expect(world.currentRequest()!.codeHash).toBe(hashEmailChangeCode(resent, CODE_SECRET))
    expect(world.currentRequest()!.codeHash).not.toBe(hashEmailChangeCode("123456", CODE_SECRET))
  })

  it("allows one request a day and answers RATE_LIMITED after it (rate-limits.md §2 п. 8)", async () => {
    const world = createWorld()

    await resolver.Mutation.requestEmailChange({}, { newEmail: "new@example.test" }, world.ctx as never)

    expect(
      await failure(() =>
        resolver.Mutation.requestEmailChange({}, { newEmail: "new@example.test" }, world.ctx as never)
      )
    ).toBe("RATE_LIMITED")
    expect(world.sentMail).toHaveLength(1)
  })
})

describe("confirmEmailChange", () => {
  it("changes the address at once, keeps every session and audits the change", async () => {
    const world = createWorld({ request: pendingRequest() })

    const result = await resolver.Mutation.confirmEmailChange({}, { code: "123456" }, world.ctx as never)

    expect(result).toEqual({ email: "n•••@example.test", changedAt: NOW.toISOString() })
    expect(world.users[0]!.email).toBe("new@example.test")
    expect(world.currentRequest()).toBeNull()

    // AC-1: сессии остаются активными — ни отзыва, ни новой выдачи (журнал §25.8).
    expect(world.sessions.every((session) => session.revokedAt === null)).toBe(true)
    expect(world.ctx.prisma.session.updateMany).not.toHaveBeenCalled()

    expect(world.audit).toHaveLength(1)
    expect(world.audit[0]).toMatchObject({
      action: "user.email.change",
      actorId: "user-1",
      entityType: "user",
      entityId: "user-1",
      diff: { targetId: "user-1", via: "self", previousEmail: "reader@example.test", newEmail: "new@example.test" }
    })

    // Шаг 3 flow #13: уведомление уходит на прежний адрес и нового не называет.
    const notice = world.sentMail.find((mail) => mail.template === "email_change_notice")
    expect(notice).toMatchObject({ to: "reader@example.test" })
    expect(notice!.text).not.toContain("new@example.test")
  })

  it("keeps the completed change when the notification cannot be delivered", async () => {
    const world = createWorld({ request: pendingRequest(), noticeFails: true })

    await resolver.Mutation.confirmEmailChange({}, { code: "123456" }, world.ctx as never)

    expect(world.users[0]!.email).toBe("new@example.test")
  })

  it("counts a wrong code and closes the request once the attempts run out", async () => {
    const world = createWorld({ request: pendingRequest({ attempts: EMAIL_CHANGE_CODE_ATTEMPTS - 2 }) })

    expect(await failure(() => resolver.Mutation.confirmEmailChange({}, { code: "000000" }, world.ctx as never))).toBe(
      "VALIDATION_ERROR"
    )
    expect(world.currentRequest()).toMatchObject({ attempts: EMAIL_CHANGE_CODE_ATTEMPTS - 1 })

    expect(await failure(() => resolver.Mutation.confirmEmailChange({}, { code: "000000" }, world.ctx as never))).toBe(
      "VALIDATION_ERROR"
    )
    expect(world.currentRequest()).toBeNull()
    expect(world.users[0]!.email).toBe("reader@example.test")
  })

  it("answers NOT_FOUND for an expired request and for no request at all", async () => {
    const expired = createWorld({ request: pendingRequest({ expiresAt: new Date(NOW.getTime() - 1000) }) })
    const missing = createWorld()

    expect(
      await failure(() => resolver.Mutation.confirmEmailChange({}, { code: "123456" }, expired.ctx as never))
    ).toBe("NOT_FOUND")
    expect(expired.currentRequest()).toBeNull()
    expect(
      await failure(() => resolver.Mutation.confirmEmailChange({}, { code: "123456" }, missing.ctx as never))
    ).toBe("NOT_FOUND")
  })

  it("reports a taken address only at the code step and closes the request", async () => {
    const world = createWorld({
      users: [reader(), reader({ id: "user-2", email: "new@example.test" })],
      request: pendingRequest()
    })

    expect(await failure(() => resolver.Mutation.confirmEmailChange({}, { code: "123456" }, world.ctx as never))).toBe(
      "CONFLICT"
    )
    expect(world.currentRequest()).toBeNull()
    expect(world.users[0]!.email).toBe("reader@example.test")
  })
})

describe("cancelEmailChange", () => {
  it("closes the open request and leaves the address alone", async () => {
    const world = createWorld({ request: pendingRequest() })

    const state = await resolver.Mutation.cancelEmailChange({}, {}, world.ctx as never)

    expect(state).toEqual({ currentEmailMasked: "r•••@example.test", pending: null })
    expect(world.currentRequest()).toBeNull()
    expect(world.users[0]!.email).toBe("reader@example.test")
  })
})

describe("maskEmail", () => {
  it("keeps the domain and hides the rest of the local part", () => {
    expect(maskEmail("reader@example.test")).toBe("r•••@example.test")
    expect(maskEmail("a@example.test")).toBe("a•••@example.test")
    expect(maskEmail("broken")).toBe("•••")
  })
})
