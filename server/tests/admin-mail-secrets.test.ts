import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import { getAdminMail, resendMail } from "../src/admin/mail"
import { createMailService } from "../src/mail/service"
import { createFakeTransport } from "../src/mail/transports/fake"
import { createMagicLinkMail, MAGIC_LINK_TEMPLATE } from "../src/mail/messages"
import type { AppLogger } from "../src/observability/logger"
import type { GraphQLContext } from "../src/prisma"
import { createMemoryStore } from "./helpers/mail-memory-store"

const token = "c".repeat(64)
const magicLinkUrl = `https://altera.example/auth/verify?token=${token}`

/** Письмо входа проходит реальный mail-модуль, история читается разделом `/admin/mail`. */
async function storeMagicLinkMail() {
  const logger: AppLogger = { log: vi.fn() }
  const { store, messages } = createMemoryStore()
  const transport = createFakeTransport()
  const mail = createMailService({ store, transport, logger, from: "Altera <no-reply@altera.test>" })
  const { message, sanitizedBody } = createMagicLinkMail("ru", magicLinkUrl)

  await mail.send({
    template: MAGIC_LINK_TEMPLATE,
    to: "reader@example.test",
    content: { subject: message.subject, text: message.text, html: message.html },
    sanitizedBody,
    requestId: "req-secret"
  })

  const [stored] = [...messages.values()]
  return { stored: stored!, transport }
}

function ownerContext(record: Record<string, unknown>) {
  const auditLog = { create: vi.fn().mockResolvedValue({ id: "audit-1" }), findFirst: vi.fn().mockResolvedValue(null) }
  const send = vi.fn()
  const ctx = {
    currentUser: {
      id: "owner-1",
      role: "owner",
      archivedAt: null,
      planTier: "free",
      planUntil: null,
      permissionExceptions: []
    },
    requestId: "req-secret",
    piiHasher: { email: (value: string) => `hash-${value}`, ip: (value: string) => value },
    mail: { send },
    prisma: {
      mailMessage: { findUnique: vi.fn().mockResolvedValue(record) },
      auditLog,
      article: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([]) }
    }
  } as unknown as GraphQLContext
  return { ctx, send }
}

function cardRecord(stored: { template: string; subject: string; sanitizedBody: string }) {
  return {
    id: "mail-1",
    template: stored.template,
    recipientEmail: "reader@example.test",
    subject: stored.subject,
    sanitizedBody: stored.sanitizedBody,
    status: "failed",
    provider: "fake",
    messageId: null,
    deliveryErrorClass: "ProviderError",
    objectType: null,
    objectId: null,
    jobId: null,
    queuedAt: new Date("2026-09-20T10:00:00.000Z"),
    sentAt: null,
    createdAt: new Date("2026-09-20T10:00:00.000Z"),
    deliveryEvents: []
  }
}

describe("копия письма входа в разделе /admin/mail", () => {
  it("не содержит токен, ссылку входа и параметр token", async () => {
    const { stored, transport } = await storeMagicLinkMail()
    expect(transport.sent[0]?.text).toContain(token)

    const { ctx } = ownerContext(cardRecord(stored))
    const card = await getAdminMail(ctx, "mail-1")

    expect(card?.template).toBe(MAGIC_LINK_TEMPLATE)
    expect(card?.body).toContain("[секрет не показывается]")
    expect(card?.body).not.toContain(token)
    expect(card?.body).not.toContain("token=")
    expect(card?.body).not.toContain(magicLinkUrl)
  })

  it("не предлагает повтор и отклоняет его даже владельцу", async () => {
    const { stored } = await storeMagicLinkMail()
    const { ctx, send } = ownerContext(cardRecord(stored))

    const card = await getAdminMail(ctx, "mail-1")
    expect(card?.canResend).toBe(false)

    await expect(resendMail(ctx, "mail-1")).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "FORBIDDEN", action: "mail.resend" }
    })
    expect(send).not.toHaveBeenCalled()
  })
})
