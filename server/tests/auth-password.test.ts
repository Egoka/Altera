import { beforeAll, describe, expect, it, onTestFinished, vi } from "vitest"
import {
  ARGON2_PROFILE,
  assertPasswordAcceptable,
  checkPassword,
  hashPassword,
  needsRehash,
  parsePasswordHash,
  passwordLength,
  verifyAgainstDummyPassword,
  verifyPassword
} from "../src/auth/password"
import { isBlockedPassword } from "../src/auth/password-blocklist"
import { hashOpaqueToken } from "../src/auth/token-hash"
import { createTestRateLimiter } from "./helpers/rate-limit"

// Проверка фиктивного хэша обёрнута в `vi.fn` поверх настоящей функции: по умолчанию каждый тест
// платит за неё полный Argon2id, а подменяет её только тест корзины IP (причина — у него).
vi.mock("../src/auth/password", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/password")>()
  return { ...actual, verifyAgainstDummyPassword: vi.fn(actual.verifyAgainstDummyPassword) }
})

/**
 * Ветка пароля T-115: регистрация с паролем, подтверждение адреса, вход, сброс письмом и смена
 * пароля в кабинете. Критерии задачи 3 («ответы не раскрывают существование аккаунта») и 4
 * («попытки входа ограничены утверждённым лимитом») проверяются здесь; критерии 1 и 2 —
 * браузерным сценарием `web/tests/e2e/115-password-login.spec.ts`.
 */

// Резолвер импортируется динамически: он читает секреты из env на уровне модуля.
let resolver: typeof import("../src/graphql/password/resolver").default

beforeAll(async () => {
  vi.stubEnv("JWT_ACCESS_SECRET", "t115-test-access-secret")
  vi.stubEnv("MAGIC_LINK_BASE_URL", "http://127.0.0.1:4173/auth/verify")
  resolver = (await import("../src/graphql/password/resolver")).default
})

const GOOD_PASSWORD = "сорок пять зелёных яблок"
const OTHER_PASSWORD = "восемь синих виноградин"

interface FakeUser {
  id: string
  email: string
  name: string
  handle: string
  locale: "ru" | "en"
  role: string
  archivedAt: Date | null
  archiveMode: "self" | "admin" | "emergency" | null
  passwordHash: string | null
  passwordUpdatedAt: Date | null
  emailVerifiedAt: Date | null
}

interface FakePasswordToken {
  id: string
  tokenHash: string
  email: string
  purpose: "email_confirm" | "password_reset"
  locale: "ru" | "en"
  next: string | null
  expiresAt: Date
  usedAt: Date | null
}

interface FakeSession {
  id: string
  userId: string
  tokenHash: string
  limited: boolean
  revokedAt: Date | null
}

const user = (overrides: Partial<FakeUser> & { email: string }): FakeUser => ({
  id: `user-${overrides.email}`,
  name: "",
  handle: `u-${overrides.email.split("@")[0]}`,
  locale: "ru",
  role: "reader",
  archivedAt: null,
  archiveMode: null,
  passwordHash: null,
  passwordUpdatedAt: null,
  emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides
})

function createWorld(options: { users?: FakeUser[]; publishedTerms?: number | null } = {}) {
  const users = [...(options.users ?? [])]
  const passwordTokens: FakePasswordToken[] = []
  const magicLinkTokens: { email: string; tokenHash: string }[] = []
  const appealTokens: { userId: string; tokenHash: string; expiresAt: Date }[] = []
  const sessions: FakeSession[] = []
  const sentMail: { to: string; template: string; subject: string; text: string; sanitizedBody: string }[] = []
  const logs: { event: string; level: string; data?: Record<string, unknown> }[] = []

  const legalTexts =
    options.publishedTerms === null || options.publishedTerms === undefined
      ? []
      : [{ id: "terms-current", kind: "terms", locale: "ru", version: options.publishedTerms, status: "published" }]

  const prisma = {
    legalText: {
      findFirst: vi.fn(async ({ where }: { where: { kind: string; locale: string; status: string } }) =>
        legalTexts.find(
          (text) => text.kind === where.kind && text.locale === where.locale && text.status === where.status
        )
      ),
      findMany: vi.fn(async () => legalTexts.map(({ id }) => ({ id }))),
      count: vi.fn(async () => 0)
    },
    userLegalConsent: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async () => ({}))
    },
    user: {
      findUnique: vi.fn(
        async ({ where }: { where: { email?: string; id?: string } }) =>
          users.find((candidate) => candidate.email === where.email || candidate.id === where.id) ?? null
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { ...user({ email: String(data.email) }), ...data } as unknown as FakeUser
        users.push(created)
        return created
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const found = users.find((candidate) => candidate.id === where.id)
        if (!found) throw new Error("not found")
        Object.assign(found, data)
        return found
      })
    },
    handleHistory: { create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
    passwordToken: {
      findUnique: vi.fn(
        async ({ where }: { where: { tokenHash: string } }) =>
          passwordTokens.find((token) => token.tokenHash === where.tokenHash) ?? null
      ),
      upsert: vi.fn(
        async ({
          where,
          create
        }: {
          where: { email_purpose: { email: string; purpose: string } }
          create: Record<string, unknown>
        }) => {
          const index = passwordTokens.findIndex(
            (token) => token.email === where.email_purpose.email && token.purpose === where.email_purpose.purpose
          )
          const record = { id: `token-${passwordTokens.length + 1}`, ...create } as unknown as FakePasswordToken
          if (index >= 0) passwordTokens.splice(index, 1, record)
          else passwordTokens.push(record)
          return record
        }
      ),
      // Та же семантика, что у условного UPDATE резолвера: гасится только непогашенный токен.
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; usedAt: null }; data: { usedAt: Date } }) => {
        const record = passwordTokens.find((token) => token.id === where.id && token.usedAt === null)
        if (!record) return { count: 0 }
        record.usedAt = data.usedAt
        return { count: 1 }
      }),
      deleteMany: vi.fn(async ({ where }: { where: { email: string; purpose: { in: string[] } } }) => {
        for (let index = passwordTokens.length - 1; index >= 0; index -= 1) {
          const token = passwordTokens[index]
          if (token && token.email === where.email && where.purpose.in.includes(token.purpose)) {
            passwordTokens.splice(index, 1)
          }
        }
        return { count: 0 }
      })
    },
    magicLinkToken: {
      upsert: vi.fn(async ({ create }: { create: { email: string; tokenHash: string } }) => {
        magicLinkTokens.push({ email: create.email, tokenHash: create.tokenHash })
        return create
      })
    },
    accountAppealToken: {
      upsert: vi.fn(async ({ create }: { create: { userId: string; tokenHash: string; expiresAt: Date } }) => {
        appealTokens.push({ userId: create.userId, tokenHash: create.tokenHash, expiresAt: create.expiresAt })
        return create
      })
    },
    session: {
      create: vi.fn(async ({ data }: { data: { userId: string; tokenHash: string; limited: boolean } }) => {
        const created = {
          id: `session-${sessions.length + 1}`,
          userId: data.userId,
          tokenHash: data.tokenHash,
          limited: data.limited,
          revokedAt: null
        }
        sessions.push(created)
        return created
      }),
      updateMany: vi.fn(
        async ({
          where,
          data
        }: {
          where: { userId: string; id?: { not: string }; revokedAt: null }
          data: { revokedAt: Date }
        }) => {
          const affected = sessions.filter(
            (session) =>
              session.userId === where.userId &&
              session.revokedAt === null &&
              (where.id === undefined || session.id !== where.id.not)
          )
          for (const session of affected) session.revokedAt = data.revokedAt
          return { count: affected.length }
        }
      )
    },
    $transaction: vi.fn(async (run: (client: unknown) => unknown) => run(prisma))
  }

  const logger = {
    log: (entry: { event: string; level: string; data?: Record<string, unknown> }) => {
      logs.push({ event: entry.event, level: entry.level, data: entry.data })
    }
  }

  const ctx = {
    prisma,
    currentUser: null as FakeUser | null,
    sessionId: null as string | null,
    requestId: "req-t115",
    requestMeta: { userAgent: "Chrome", ip: "203.0.113.10" },
    logger,
    rateLimiter: createTestRateLimiter({ logger: logger as never }),
    piiHasher: { email: (value: string) => `hash(${value})` },
    mail: {
      send: vi.fn(
        async (input: {
          to: string
          template: string
          content: { subject: string; text: string }
          sanitizedBody: string
        }) => {
          sentMail.push({
            to: input.to,
            template: input.template,
            subject: input.content.subject,
            text: input.content.text,
            sanitizedBody: input.sanitizedBody
          })
          return { mailId: `mail-${sentMail.length}`, messageId: "<id>" }
        }
      )
    }
  }

  return { ctx, users, passwordTokens, magicLinkTokens, appealTokens, sessions, sentMail, logs }
}

/** Токен из письма: он есть только в ссылке, поэтому берётся из текста так же, как у читателя. */
const tokenFromMail = (text: string): string => {
  const match = /token=([0-9a-f]{64})/.exec(text)
  if (!match?.[1]) throw new Error(`no token in mail: ${text}`)
  return match[1]
}

const mutation = (name: keyof typeof resolver.Mutation) =>
  resolver.Mutation[name] as (parent: unknown, args: never, ctx: never) => Promise<never>

const consent = { termsVersion: null, privacyVersion: null }

describe("требования к паролю", () => {
  it("принимает длину 15…128 code points и считает символы, а не единицы UTF-16", () => {
    expect(checkPassword("a".repeat(14))).toBe("length")
    expect(checkPassword("прогулка в саду")).toBeNull()
    // Эмодзи — один символ, а не два: пятнадцать таких символов проходят по длине, а отказ
    // приходит от списка ожидаемых строк, не от неё.
    expect(passwordLength("🌿".repeat(15))).toBe(15)
    expect(checkPassword(`🌿🌲🍇 тихий вечер`)).toBeNull()
    expect(checkPassword("🌿".repeat(129))).toBe("length")
  })

  it("не требует классов символов: длинная строчная фраза принимается", () => {
    expect(checkPassword("прогулка вдоль тихой реки")).toBeNull()
  })

  it("отклоняет ожидаемые строки: список, повтор, подстановки, название сервиса и свои данные", () => {
    expect(isBlockedPassword("passwordpassword")).toBe(true)
    expect(isBlockedPassword("p@ssw0rdp@ssw0rd")).toBe(true)
    expect(isBlockedPassword("altera-altera-altera")).toBe(true)
    expect(isBlockedPassword("123456789012345")).toBe(true)
    expect(isBlockedPassword("qwertyuiopasdfgh")).toBe(true)
    expect(isBlockedPassword("aaaaaaaaaaaaaaaa")).toBe(true)
    expect(isBlockedPassword("reader-example-reader-example", { email: "reader@example.test" })).toBe(false)
    expect(isBlockedPassword("readerexample2026", { email: "readerexample@altera.test" })).toBe(true)
    expect(isBlockedPassword("u-12345678u-12345678", { handle: "u-12345678" })).toBe(true)
    expect(isBlockedPassword("прогулка вдоль тихой реки", { email: "reader@example.test" })).toBe(false)
  })

  it("сообщает нарушенное правило, не раскрывая сам пароль", () => {
    expect(() => assertPasswordAcceptable("короткий", { requestId: "req-1" })).toThrowError(
      expect.objectContaining({
        extensions: expect.objectContaining({ code: "VALIDATION_ERROR", field: "password", rule: "15..128 characters" })
      })
    )

    try {
      assertPasswordAcceptable("passwordpassword", { requestId: "req-1" })
      throw new Error("unreachable")
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain("passwordpassword")
    }
  })
})

describe("хранение пароля", () => {
  it("даёт PHC-строку Argon2id с утверждённым профилем и уникальной солью", async () => {
    const first = await hashPassword(GOOD_PASSWORD)
    const second = await hashPassword(GOOD_PASSWORD)

    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[^$]+\$[^$]+$/)
    expect(first).not.toBe(second)
    expect(first).not.toContain(GOOD_PASSWORD)
    expect(parsePasswordHash(first)?.profile).toMatchObject(ARGON2_PROFILE)
  })

  it("сверяет пароль в форме NFC и отвергает чужой", async () => {
    // Одна и та же буква «й» в разложенной и составной форме — один пароль.
    const stored = await hashPassword("длинный пароль про йогурт".normalize("NFD"))

    expect(await verifyPassword(stored, "длинный пароль про йогурт".normalize("NFC"))).toBe(true)
    expect(await verifyPassword(stored, OTHER_PASSWORD)).toBe(false)
    expect(await verifyPassword("не-PHC-строка", GOOD_PASSWORD)).toBe(false)
  })

  it("помечает к пересчёту хэш со слабым профилем", async () => {
    const weak = await hashPassword(GOOD_PASSWORD, { memory: 4096, passes: 1, parallelism: 1, tagLength: 32 })

    expect(needsRehash(weak)).toBe(true)
    expect(needsRehash(await hashPassword(GOOD_PASSWORD))).toBe(false)
  })
})

describe("регистрация с паролем", () => {
  it("создаёт аккаунт без подтверждения адреса и отправляет письмо со ссылкой", async () => {
    const world = createWorld()

    const result = await mutation("registerWithPassword")(
      null,
      { email: "New@Example.test", password: GOOD_PASSWORD, consentVersion: consent, locale: "ru" } as never,
      world.ctx as never
    )

    expect(result).toMatchObject({ ok: true })
    expect(world.users).toHaveLength(1)
    expect(world.users[0]).toMatchObject({ email: "new@example.test", emailVerifiedAt: null })
    expect(world.users[0]?.passwordHash).toMatch(/^\$argon2id\$/)
    expect(world.sentMail).toHaveLength(1)
    expect(world.sentMail[0]).toMatchObject({ to: "new@example.test", template: "email_confirm" })
    // Секрет не попадает в копию письма для истории (`40-admin/mail.md` §3).
    expect(world.sentMail[0]?.sanitizedBody).not.toContain(tokenFromMail(world.sentMail[0]?.text ?? ""))
  })

  it("не даёт войти по паролю до подтверждения адреса", async () => {
    const world = createWorld()
    await mutation("registerWithPassword")(
      null,
      { email: "new@example.test", password: GOOD_PASSWORD, consentVersion: consent, locale: "ru" } as never,
      world.ctx as never
    )

    const login = await mutation("loginWithPassword")(
      null,
      { email: "new@example.test", password: GOOD_PASSWORD } as never,
      world.ctx as never
    )

    expect(login).toMatchObject({ outcome: "email_unconfirmed", session: null })
    expect(world.sessions).toHaveLength(0)
  })

  it("отвечает занятому адресу так же, но чужой пароль не меняет", async () => {
    const existing = user({ email: "taken@example.test", passwordHash: await hashPassword(OTHER_PASSWORD) })
    const world = createWorld({ users: [existing] })

    const result = await mutation("registerWithPassword")(
      null,
      { email: "taken@example.test", password: GOOD_PASSWORD, consentVersion: consent, locale: "ru" } as never,
      world.ctx as never
    )

    expect(result).toMatchObject({ ok: true })
    expect(world.users).toHaveLength(1)
    expect(await verifyPassword(existing.passwordHash ?? "", OTHER_PASSWORD)).toBe(true)
    expect(world.sentMail[0]).toMatchObject({ to: "taken@example.test", template: "password_account_exists" })
  })

  it("продолжает незаконченную регистрацию того же адреса новым паролем и письмом", async () => {
    const pending = user({
      email: "pending@example.test",
      emailVerifiedAt: null,
      passwordHash: await hashPassword(OTHER_PASSWORD)
    })
    const world = createWorld({ users: [pending] })

    await mutation("registerWithPassword")(
      null,
      { email: "pending@example.test", password: GOOD_PASSWORD, consentVersion: consent, locale: "ru" } as never,
      world.ctx as never
    )

    expect(world.users).toHaveLength(1)
    expect(await verifyPassword(world.users[0]?.passwordHash ?? "", GOOD_PASSWORD)).toBe(true)
    expect(world.sentMail[0]).toMatchObject({ template: "email_confirm" })
  })
})

describe("подтверждение адреса", () => {
  it("подтверждает адрес, выдаёт сессию и гасит ссылку", async () => {
    const world = createWorld()
    await mutation("registerWithPassword")(
      null,
      { email: "new@example.test", password: GOOD_PASSWORD, consentVersion: consent, locale: "ru" } as never,
      world.ctx as never
    )
    const token = tokenFromMail(world.sentMail[0]?.text ?? "")

    const confirmed = await mutation("confirmEmail")(null, { token } as never, world.ctx as never)

    expect(confirmed).toMatchObject({ outcome: "authenticated" })
    expect(world.users[0]?.emailVerifiedAt).toBeInstanceOf(Date)
    expect(world.sessions).toHaveLength(1)

    await expect(mutation("confirmEmail")(null, { token } as never, world.ctx as never)).rejects.toMatchObject({
      extensions: { code: "NOT_FOUND" }
    })
  })

  it("после подтверждения пускает по паролю", async () => {
    const world = createWorld()
    await mutation("registerWithPassword")(
      null,
      { email: "new@example.test", password: GOOD_PASSWORD, consentVersion: consent, locale: "ru" } as never,
      world.ctx as never
    )
    await mutation("confirmEmail")(
      null,
      { token: tokenFromMail(world.sentMail[0]?.text ?? "") } as never,
      world.ctx as never
    )

    const login = await mutation("loginWithPassword")(
      null,
      { email: "new@example.test", password: GOOD_PASSWORD } as never,
      world.ctx as never
    )

    expect(login).toMatchObject({ outcome: "authenticated" })
    expect((login as unknown as { session: { accessToken: string } }).session.accessToken).toBeTruthy()
  })
})

describe("вход по паролю", () => {
  it("отвечает одинаково на неизвестный адрес и на неверный пароль", async () => {
    const world = createWorld({
      users: [user({ email: "reader@example.test", passwordHash: await hashPassword(GOOD_PASSWORD) })]
    })

    const unknown = await mutation("loginWithPassword")(
      null,
      { email: "nobody@example.test", password: GOOD_PASSWORD } as never,
      world.ctx as never
    ).catch((error: { extensions?: Record<string, unknown>; message: string }) => error)
    const wrong = await mutation("loginWithPassword")(
      null,
      { email: "reader@example.test", password: OTHER_PASSWORD } as never,
      world.ctx as never
    ).catch((error: { extensions?: Record<string, unknown>; message: string }) => error)

    expect((unknown as { extensions: Record<string, unknown> }).extensions).toEqual(
      (wrong as { extensions: Record<string, unknown> }).extensions
    )
    expect((unknown as { message: string }).message).toBe((wrong as { message: string }).message)
    expect((unknown as { extensions: { code: string } }).extensions.code).toBe("UNAUTHENTICATED")
  })

  it("уводит самостоятельно архивированный аккаунт в ограниченную сессию", async () => {
    const world = createWorld({
      users: [
        user({
          email: "archived@example.test",
          passwordHash: await hashPassword(GOOD_PASSWORD),
          archivedAt: new Date(),
          archiveMode: "self"
        })
      ]
    })

    const result = await mutation("loginWithPassword")(
      null,
      { email: "archived@example.test", password: GOOD_PASSWORD } as never,
      world.ctx as never
    )

    expect(result).toMatchObject({ outcome: "archived_self" })
    expect(world.sessions[0]?.limited).toBe(true)
  })

  it("заблокированному администратором сессии не даёт", async () => {
    const world = createWorld({
      users: [
        user({
          email: "blocked@example.test",
          passwordHash: await hashPassword(GOOD_PASSWORD),
          archivedAt: new Date(),
          archiveMode: "admin"
        })
      ]
    })

    const result = await mutation("loginWithPassword")(
      null,
      { email: "blocked@example.test", password: GOOD_PASSWORD } as never,
      world.ctx as never
    )

    expect(result).toMatchObject({ outcome: "archived_admin", session: null })
    const { appealToken } = result as unknown as { appealToken: string }
    // Форма оспаривания принимает только токен из `account_appeal_tokens`, а не токен согласия.
    expect(world.appealTokens).toEqual([
      { userId: "user-blocked@example.test", tokenHash: hashOpaqueToken(appealToken), expiresAt: expect.any(Date) }
    ])
    expect(world.magicLinkTokens).toHaveLength(0)
    expect(world.sessions).toHaveLength(0)
  })

  it("не пишет пароль в журнал при отказе", async () => {
    const world = createWorld({
      users: [user({ email: "reader@example.test", passwordHash: await hashPassword(GOOD_PASSWORD) })]
    })

    await expect(
      mutation("loginWithPassword")(
        null,
        { email: "reader@example.test", password: OTHER_PASSWORD } as never,
        world.ctx as never
      )
    ).rejects.toThrow()

    expect(JSON.stringify(world.logs)).not.toContain(OTHER_PASSWORD)
    expect(world.logs.some((entry) => entry.event === "auth.login.failed" && entry.data?.reason === "password")).toBe(
      true
    )
  })
})

describe("сброс пароля", () => {
  it("отвечает одинаково существующему и неизвестному адресу, письмо уходит только первому", async () => {
    const world = createWorld({ users: [user({ email: "reader@example.test" })] })

    const known = await mutation("requestPasswordReset")(
      null,
      { email: "reader@example.test", locale: "ru" } as never,
      world.ctx as never
    )
    const unknown = await mutation("requestPasswordReset")(
      null,
      { email: "nobody@example.test", locale: "ru" } as never,
      world.ctx as never
    )

    expect(known).toEqual(unknown)
    expect(world.sentMail.map((mail) => mail.to)).toEqual(["reader@example.test"])
    expect(world.sentMail[0]?.template).toBe("password_reset")
  })

  it("меняет пароль по ссылке, закрывает прежние сессии и выдаёт новую", async () => {
    const reader = user({ email: "reader@example.test", passwordHash: await hashPassword(OTHER_PASSWORD) })
    const world = createWorld({ users: [reader] })
    world.sessions.push({ id: "session-old", userId: reader.id, tokenHash: "old", limited: false, revokedAt: null })

    await mutation("requestPasswordReset")(
      null,
      { email: "reader@example.test", locale: "ru" } as never,
      world.ctx as never
    )
    const result = await mutation("resetPassword")(
      null,
      { token: tokenFromMail(world.sentMail[0]?.text ?? ""), password: GOOD_PASSWORD } as never,
      world.ctx as never
    )

    expect(result).toMatchObject({ outcome: "authenticated" })
    expect(await verifyPassword(reader.passwordHash ?? "", GOOD_PASSWORD)).toBe(true)
    expect(world.sessions.find((session) => session.id === "session-old")?.revokedAt).toBeInstanceOf(Date)
    expect(world.sessions.filter((session) => session.revokedAt === null)).toHaveLength(1)
  })

  it("не тратит ссылку на пароль, не прошедший требования", async () => {
    const world = createWorld({ users: [user({ email: "reader@example.test" })] })
    await mutation("requestPasswordReset")(
      null,
      { email: "reader@example.test", locale: "ru" } as never,
      world.ctx as never
    )
    const token = tokenFromMail(world.sentMail[0]?.text ?? "")

    await expect(
      mutation("resetPassword")(null, { token, password: "короткий" } as never, world.ctx as never)
    ).rejects.toMatchObject({ extensions: { code: "VALIDATION_ERROR", field: "newPassword" } })

    await expect(
      mutation("resetPassword")(null, { token, password: GOOD_PASSWORD } as never, world.ctx as never)
    ).resolves.toMatchObject({ outcome: "authenticated" })
  })
})

describe("смена пароля в кабинете", () => {
  const withSession = (world: ReturnType<typeof createWorld>, actor: FakeUser, sessionId: string) => {
    world.ctx.currentUser = actor
    world.ctx.sessionId = sessionId
    world.sessions.push({ id: sessionId, userId: actor.id, tokenHash: "current", limited: false, revokedAt: null })
    return world
  }

  it("требует текущий пароль и закрывает остальные сессии, оставляя свою", async () => {
    const actor = user({ email: "reader@example.test", passwordHash: await hashPassword(OTHER_PASSWORD) })
    const world = withSession(createWorld({ users: [actor] }), actor, "session-current")
    world.sessions.push({ id: "session-phone", userId: actor.id, tokenHash: "phone", limited: false, revokedAt: null })

    await expect(
      mutation("setPassword")(null, { newPassword: GOOD_PASSWORD } as never, world.ctx as never)
    ).rejects.toMatchObject({ extensions: { code: "VALIDATION_ERROR", field: "currentPassword" } })

    await expect(
      mutation("setPassword")(
        null,
        { currentPassword: OTHER_PASSWORD, newPassword: GOOD_PASSWORD } as never,
        world.ctx as never
      )
    ).resolves.toBe(true)

    expect(await verifyPassword(actor.passwordHash ?? "", GOOD_PASSWORD)).toBe(true)
    expect(world.sessions.find((session) => session.id === "session-phone")?.revokedAt).toBeInstanceOf(Date)
    expect(world.sessions.find((session) => session.id === "session-current")?.revokedAt).toBeNull()
  })

  it("аккаунту без пароля даёт задать первый без текущего", async () => {
    const actor = user({ email: "link@example.test" })
    const world = withSession(createWorld({ users: [actor] }), actor, "session-current")

    await expect(
      mutation("setPassword")(null, { newPassword: GOOD_PASSWORD } as never, world.ctx as never)
    ).resolves.toBe(true)
    expect(await verifyPassword(actor.passwordHash ?? "", GOOD_PASSWORD)).toBe(true)
  })
})

/**
 * Критерий 4 задачи: попытки входа ограничены утверждённым владельцем лимитом — RL-14
 * (5 неуспешных за 15 минут на адрес) и RL-15 (30 за 15 минут на IP), журнал §44 п. 1.
 * Считаются только неуспехи, успешная проверка очищает корзину адреса, постоянной блокировки нет.
 */
describe("лимит попыток входа по паролю", () => {
  const failLogin = (world: ReturnType<typeof createWorld>, email: string) =>
    mutation("loginWithPassword")(null, { email, password: OTHER_PASSWORD } as never, world.ctx as never).catch(
      (error: { extensions?: { code?: string; retryAfter?: number } }) => error
    )

  it("отклоняет шестую попытку одного адреса и не трогает соседний", async () => {
    const world = createWorld({
      users: [user({ email: "reader@example.test", passwordHash: await hashPassword(GOOD_PASSWORD) })]
    })

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const rejected = await failLogin(world, "reader@example.test")
      expect((rejected as { extensions: { code: string } }).extensions.code).toBe("UNAUTHENTICATED")
    }

    const limited = await failLogin(world, "reader@example.test")
    expect((limited as { extensions: { code: string; retryAfter: number } }).extensions).toMatchObject({
      code: "RATE_LIMITED"
    })
    expect((limited as { extensions: { retryAfter: number } }).extensions.retryAfter).toBeGreaterThan(0)

    // Корзина именно адреса: соседний адрес отвечает по-прежнему «неверный пароль».
    const other = await failLogin(world, "other@example.test")
    expect((other as { extensions: { code: string } }).extensions.code).toBe("UNAUTHENTICATED")
  })

  it("постоянной блокировки нет: успешная проверка очищает корзину адреса", async () => {
    const world = createWorld({
      users: [user({ email: "reader@example.test", passwordHash: await hashPassword(GOOD_PASSWORD) })]
    })

    for (let attempt = 1; attempt <= 4; attempt += 1) await failLogin(world, "reader@example.test")
    await expect(
      mutation("loginWithPassword")(
        null,
        { email: "reader@example.test", password: GOOD_PASSWORD } as never,
        world.ctx as never
      )
    ).resolves.toMatchObject({ outcome: "authenticated" })

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const rejected = await failLogin(world, "reader@example.test")
      expect((rejected as { extensions: { code: string } }).extensions.code).toBe("UNAUTHENTICATED")
    }
  })

  it("корзина адреса запроса отсекает перебор по разным аккаунтам на тридцать первой попытке", async () => {
    // Тридцать неизвестных адресов — тридцать проверок фиктивного хэша с профилем продукта
    // (m=19 MiB, t=2): ~30 мс каждая в покое и в разы дольше, когда хук pre-commit гоняет наборы
    // content, web и server параллельно, — тест упирался в таймаут 5 с. Он проверяет счёт корзины,
    // а не стоимость хэша, поэтому подменяется только длительность проверки: исход тот же
    // (`false` → неуспех → штраф обеих корзин). Настоящая проверка остаётся в «вход по паролю».
    const dummyCheck = vi.mocked(verifyAgainstDummyPassword).mockClear().mockResolvedValue(false)
    onTestFinished(() => {
      dummyCheck.mockReset()
    })
    const world = createWorld()

    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const rejected = await failLogin(world, `nobody-${attempt}@example.test`)
      expect((rejected as { extensions: { code: string } }).extensions.code).toBe("UNAUTHENTICATED")
    }

    const limited = await failLogin(world, "nobody-31@example.test")
    expect((limited as { extensions: { code: string } }).extensions.code).toBe("RATE_LIMITED")
    // Каждая из тридцати попыток прошла равную по стоимости проверку, а тридцать первая отклонена
    // до чтения базы и хэширования: перебор сверх лимита не тратит процессор сервера.
    expect(dummyCheck).toHaveBeenCalledTimes(30)
  })

  it("пишет rate_limit.hit с корзиной, но без адреса и пароля", async () => {
    const world = createWorld({
      users: [user({ email: "reader@example.test", passwordHash: await hashPassword(GOOD_PASSWORD) })]
    })

    for (let attempt = 1; attempt <= 6; attempt += 1) await failLogin(world, "reader@example.test")

    const hits = world.logs.filter((entry) => entry.event === "rate_limit.hit")
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((entry) => entry.data?.bucket === "auth.password.email")).toBe(true)
    expect(JSON.stringify(hits)).not.toContain("reader@example.test")
    expect(JSON.stringify(hits)).not.toContain(OTHER_PASSWORD)
  })
})
