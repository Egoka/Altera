import crypto from "crypto"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createFakeTransport } from "../src/mail/transports/fake"
import { createMailService } from "../src/mail/service"
import type { AppLogger, LogEntry } from "../src/observability/logger"
import { createMemoryStore } from "./helpers/mail-memory-store"

let authMutations: typeof import("../src/graphql/auth/resolver").default.Mutation

beforeAll(async () => {
  vi.stubEnv("JWT_ACCESS_SECRET", "test-access-secret")
  vi.stubEnv("MAGIC_LINK_BASE_URL", "https://altera.example/auth/verify")
  ;({ Mutation: authMutations } = (await import("../src/graphql/auth/resolver")).default)
})

beforeEach(() => {
  vi.restoreAllMocks()
})

const tokenBytes = Buffer.alloc(32, 0xcd)
const plainToken = tokenBytes.toString("hex")

function createContext(locale: "ru" | "en" = "ru") {
  vi.spyOn(crypto, "randomBytes").mockReturnValue(tokenBytes as never)
  const entries: LogEntry[] = []
  const logger: AppLogger = { log: (entry) => void entries.push(entry) }
  const { store, messages } = createMemoryStore()
  const transport = createFakeTransport()
  const mail = createMailService({ store, transport, logger, from: "Altera <no-reply@altera.test>" })
  const ctx = {
    prisma: {
      user: { findUnique: vi.fn().mockResolvedValue({ id: "user-1", locale }) },
      magicLinkToken: { upsert: vi.fn().mockResolvedValue({}) }
    },
    logger,
    piiHasher: { email: vi.fn().mockReturnValue("email-hash") },
    requestId: "request-21",
    mail
  } as never
  return { ctx, entries, messages, transport }
}

describe("письмо со ссылкой входа", () => {
  it("отправляет ссылку через mail-модуль, а в истории хранит копию без токена", async () => {
    const { ctx, messages, transport } = createContext()

    await expect(
      authMutations.requestMagicLink(null, { email: "reader@example.test", locale: "ru" }, ctx)
    ).resolves.toBe(true)

    expect(transport.sent).toHaveLength(1)
    expect(transport.sent[0]).toMatchObject({ to: "reader@example.test", subject: "Ссылка входа в Altera" })
    expect(transport.sent[0]?.text).toContain(`https://altera.example/auth/verify?token=${plainToken}`)
    expect(transport.sent[0]?.html).toContain(`https://altera.example/auth/verify?token=${plainToken}`)

    const [stored] = [...messages.values()]
    expect(stored).toMatchObject({ template: "magic_link", recipientEmail: "reader@example.test", status: "sent" })
    expect(stored?.sanitizedBody).toContain("[секрет не показывается]")
    expect(stored?.sanitizedBody).not.toContain(plainToken)
    expect(stored?.sanitizedBody).not.toContain("token=")
  })

  it("использует язык запроса для письма", async () => {
    const { ctx, transport, messages } = createContext("en")

    await authMutations.requestMagicLink(null, { email: "reader@example.test", locale: "en" }, ctx)

    expect(transport.sent[0]?.subject).toBe("Your Altera login link")
    expect([...messages.values()][0]?.sanitizedBody).toContain("[secret not shown]")
  })

  it("не пишет адрес, ссылку и токен в логи", async () => {
    const { ctx, entries } = createContext()

    await authMutations.requestMagicLink(null, { email: "reader@example.test", locale: "ru" }, ctx)

    expect(entries.map((entry) => entry.event)).toEqual(["mail.queued", "mail.sent", "auth.link.requested"])
    const serialized = JSON.stringify(entries)
    expect(serialized).not.toContain("reader@example.test")
    expect(serialized).not.toContain(plainToken)
    expect(serialized).not.toContain("auth/verify")
  })

  it("при недоступной почте возвращает PROVIDER_UNAVAILABLE: mail и фиксирует failed", async () => {
    const { ctx, transport, messages, entries } = createContext()
    transport.failWith(Object.assign(new Error("Greeting never received"), { code: "ETIMEDOUT" }))

    await expect(
      authMutations.requestMagicLink(null, { email: "reader@example.test", locale: "ru" }, ctx)
    ).rejects.toMatchObject({
      extensions: { code: "PROVIDER_UNAVAILABLE", provider: "mail", requestId: "request-21" }
    })
    expect([...messages.values()][0]).toMatchObject({ status: "failed", deliveryErrorClass: "ETIMEDOUT" })
    expect(entries.map((entry) => entry.event)).toEqual(["mail.queued", "mail.failed"])
  })
})
