import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import {
  getAdminMail,
  getMailSummary,
  listAdminMails,
  resendMail,
  resendMails,
  MAIL_BULK_RESEND_LIMIT
} from "../src/admin/mail"
import type { GraphQLContext } from "../src/prisma"

const now = new Date("2026-09-20T12:00:00.000Z")

type ViewerRole = "author" | "editor" | "moderator" | "analyst" | "admin" | "owner"

function actor(role: ViewerRole) {
  return { id: `${role}-1`, role, archivedAt: null, planTier: "free", planUntil: null, permissionExceptions: [] }
}

function mail(overrides: Record<string, unknown> = {}) {
  return {
    id: "mail-1",
    template: "article_decision",
    recipientEmail: "reader@example.test",
    subject: "Решение по статье",
    sanitizedBody: "Статья опубликована.",
    status: "sent",
    provider: "smtp",
    messageId: "<abc@altera>",
    deliveryErrorClass: null,
    objectType: "Article",
    objectId: "article-1",
    jobId: null,
    queuedAt: new Date("2026-09-20T10:00:00.000Z"),
    sentAt: new Date("2026-09-20T10:00:01.000Z"),
    createdAt: new Date("2026-09-20T10:00:00.000Z"),
    deliveryEvents: [
      { id: "event-1", status: "queued", providerEventId: null, errorClass: null, occurredAt: new Date() }
    ],
    ...overrides
  }
}

interface ContextOptions {
  role?: ViewerRole
  rows?: ReturnType<typeof mail>[]
  single?: ReturnType<typeof mail> | null
  articles?: { id: string }[]
  users?: { email: string; handle: string | null }[]
  queued?: number
  previousRetry?: { id: string } | null
  grouped?: { template: string; status: string; _count: { _all: number } }[]
  sendError?: Error
}

function context(options: ContextOptions = {}) {
  const rows = options.rows ?? [mail()]
  const mailMessage = {
    findMany: vi.fn().mockResolvedValue(rows),
    findUnique: vi.fn().mockResolvedValue(options.single === undefined ? rows[0] : options.single),
    count: vi.fn(({ where }: { where: { AND?: unknown[] } }) =>
      Promise.resolve(Array.isArray(where.AND) && where.AND.length > 1 ? (options.queued ?? 0) : rows.length)
    ),
    groupBy: vi.fn().mockResolvedValue(options.grouped ?? [])
  }
  const auditLog = {
    create: vi.fn().mockResolvedValue({ id: "audit-1" }),
    findFirst: vi.fn().mockResolvedValue(options.previousRetry ?? null)
  }
  const send = options.sendError
    ? vi.fn().mockRejectedValue(options.sendError)
    : vi.fn().mockResolvedValue({ mailId: "mail-new", messageId: "<new@altera>" })

  const ctx = {
    currentUser: actor(options.role ?? "admin"),
    requestId: "req-mail",
    piiHasher: { email: (value: string) => `hash-${value}`, ip: (value: string) => value },
    mail: { send },
    prisma: {
      mailMessage,
      auditLog,
      article: { findMany: vi.fn().mockResolvedValue(options.articles ?? [{ id: "article-1" }]) },
      user: { findMany: vi.fn().mockResolvedValue(options.users ?? []) }
    }
  } as unknown as GraphQLContext

  return { ctx, mailMessage, auditLog, send }
}

describe("adminMails", () => {
  it("rejects a reader account before reading mail history", async () => {
    const { ctx, mailMessage } = context({ role: "author" })

    await expect(listAdminMails(ctx, {}, now)).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "FORBIDDEN", action: "admin.mail.read" }
    })
    expect(mailMessage.findMany).not.toHaveBeenCalled()
  })

  it("shows address and body to analyst, admin and owner", async () => {
    for (const role of ["analyst", "admin", "owner"] as const) {
      const { ctx } = context({ role })

      const list = await listAdminMails(ctx, {}, now)

      expect(list.access).toBe("full")
      expect(list.items[0]).toMatchObject({ recipientEmail: "reader@example.test", body: "Статья опубликована." })
    }
  })

  it("hides address and body from editor and moderator and scopes rows to their articles", async () => {
    for (const role of ["editor", "moderator"] as const) {
      const { ctx, mailMessage } = context({ role, users: [{ email: "reader@example.test", handle: "reader" }] })

      const list = await listAdminMails(ctx, {}, now)

      expect(list.access).toBe("scoped")
      expect(list.items[0]).toMatchObject({ recipientEmail: null, body: null, recipientHandle: "reader" })
      const where = mailMessage.findMany.mock.calls[0][0].where as { AND: Record<string, unknown>[] }
      expect(where.AND).toContainEqual({ objectType: "Article", objectId: { in: ["article-1"] } })
    }
  })

  it("applies the default seven-day period when no period is given", async () => {
    const { ctx, mailMessage } = context()

    await listAdminMails(ctx, {}, now)

    const where = mailMessage.findMany.mock.calls[0][0].where as { AND: { createdAt?: { gte?: Date } }[] }
    expect(where.AND[0].createdAt?.gte).toEqual(new Date("2026-09-13T12:00:00.000Z"))
  })

  it("audits a recipient search as a personal data read", async () => {
    const { ctx, auditLog } = context({ role: "analyst" })

    await listAdminMails(ctx, { filters: { recipient: "reader@example.test" } }, now)

    expect(auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "admin.read.personal",
        actorId: "analyst-1",
        entityType: "mailSearch",
        entityId: "hash-reader@example.test",
        context: "mail",
        purpose: "admin.mail.search",
        requestId: "req-mail"
      })
    })
  })

  it("does not audit a recipient search for editor because the address is not shown", async () => {
    const { ctx, auditLog, mailMessage } = context({ role: "editor" })

    await listAdminMails(ctx, { filters: { recipient: "reader@example.test" } }, now)

    expect(auditLog.create).not.toHaveBeenCalled()
    const where = mailMessage.findMany.mock.calls[0][0].where as { AND: Record<string, unknown>[] }
    expect(where.AND.some((condition) => "OR" in condition)).toBe(false)
  })

  it("reports waiting mail when the provider left messages queued", async () => {
    const { ctx } = context({ queued: 2 })

    const list = await listAdminMails(ctx, {}, now)

    expect(list.providerWaiting).toBe(true)
  })

  it("rejects a page size above the documented maximum", async () => {
    const { ctx } = context()

    await expect(listAdminMails(ctx, { pagination: { page: 1, limit: 101 } }, now)).rejects.toMatchObject<
      Partial<GraphQLError>
    >({
      extensions: { code: "VALIDATION_ERROR", field: "limit", rule: "max:100" }
    })
  })
})

describe("adminMail", () => {
  it("records admin.read.personal when a full-access role opens the card", async () => {
    const { ctx, auditLog } = context({ role: "admin" })

    const card = await getAdminMail(ctx, "mail-1")

    expect(card?.recipientEmail).toBe("reader@example.test")
    expect(auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "admin.read.personal",
        entityType: "mailMessage",
        entityId: "mail-1",
        purpose: "admin.mail.read"
      })
    })
  })

  it("answers NOT_FOUND for a moderator opening a mail outside their articles", async () => {
    const { ctx, auditLog } = context({ role: "moderator", articles: [{ id: "other-article" }] })

    await expect(getAdminMail(ctx, "mail-1")).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "NOT_FOUND", entity: "mailMessage" }
    })
    expect(auditLog.create).not.toHaveBeenCalled()
  })

  it("does not audit the card of an editor because address and body stay hidden", async () => {
    const { ctx, auditLog } = context({ role: "editor" })

    const card = await getAdminMail(ctx, "mail-1")

    expect(card).toMatchObject({ recipientEmail: null, body: null })
    expect(auditLog.create).not.toHaveBeenCalled()
  })
})

describe("mailSummary", () => {
  it("groups delivery counts by template", async () => {
    const { ctx } = context({
      grouped: [
        { template: "magic_link", status: "sent", _count: { _all: 4 } },
        { template: "magic_link", status: "failed", _count: { _all: 1 } },
        { template: "article_decision", status: "sent", _count: { _all: 2 } }
      ]
    })

    const rows = await getMailSummary(ctx, 7, now)

    expect(rows).toEqual([
      { template: "article_decision", queued: 0, sent: 2, bounced: 0, failed: 0 },
      { template: "magic_link", queued: 0, sent: 4, bounced: 0, failed: 1 }
    ])
  })
})

describe("resendMail", () => {
  it("is forbidden for admin because the retry permission belongs to owner", async () => {
    const { ctx, send } = context({ role: "admin", single: mail({ status: "failed" }) })

    await expect(resendMail(ctx, "mail-1")).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "FORBIDDEN", action: "mail.resend" }
    })
    expect(send).not.toHaveBeenCalled()
  })

  it("refuses to repeat a mail that carries a secret", async () => {
    const { ctx, send } = context({ role: "owner", single: mail({ template: "magic_link", status: "failed" }) })

    await expect(resendMail(ctx, "mail-1")).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "FORBIDDEN", action: "mail.resend" }
    })
    expect(send).not.toHaveBeenCalled()
  })

  it("refuses to repeat a delivered mail", async () => {
    const { ctx, send } = context({ role: "owner", single: mail({ status: "sent" }) })

    await expect(resendMail(ctx, "mail-1")).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "CONFLICT", entity: "mailMessage", expected: "failed", actual: "sent" }
    })
    expect(send).not.toHaveBeenCalled()
  })

  it("answers CONFLICT when the mail was already repeated", async () => {
    const { ctx, send } = context({
      role: "owner",
      single: mail({ status: "failed" }),
      previousRetry: { id: "audit-earlier" }
    })

    await expect(resendMail(ctx, "mail-1")).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "CONFLICT", entity: "mailMessage", expected: "not-resent", actual: "resent" }
    })
    expect(send).not.toHaveBeenCalled()
  })

  it("repeats a failed mail from the stored copy and records job.retry", async () => {
    const { ctx, send, auditLog } = context({ role: "owner", single: mail({ status: "failed" }) })

    await resendMail(ctx, "mail-1")

    expect(auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "job.retry",
        actorId: "owner-1",
        entityType: "mailMessage",
        entityId: "mail-1"
      })
    })
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "article_decision",
        to: "reader@example.test",
        sanitizedBody: "Статья опубликована.",
        content: expect.objectContaining({ subject: "Решение по статье", text: "Статья опубликована." })
      })
    )
  })
})

describe("resendMails", () => {
  it("rejects a bulk repeat above the documented maximum", async () => {
    const { ctx, send } = context({ role: "owner" })
    const ids = Array.from({ length: MAIL_BULK_RESEND_LIMIT + 1 }, (_, index) => `mail-${index}`)

    await expect(resendMails(ctx, ids)).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "VALIDATION_ERROR", field: "ids", rule: "max:100" }
    })
    expect(send).not.toHaveBeenCalled()
  })

  it("skips secret and delivered mail and repeats only the failed ones", async () => {
    const { ctx, send } = context({
      role: "owner",
      rows: [
        mail({ id: "mail-secret", template: "magic_link", status: "failed" }),
        mail({ id: "mail-sent", status: "sent" }),
        mail({ id: "mail-failed", status: "failed" })
      ]
    })

    const result = await resendMails(ctx, ["mail-secret", "mail-sent", "mail-failed", "mail-missing"])

    expect(result).toEqual({ resent: 1, skipped: 3 })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("counts a mail the provider rejected again as skipped", async () => {
    const { ctx } = context({
      role: "owner",
      rows: [mail({ id: "mail-failed", status: "failed" })],
      sendError: new Error("provider down")
    })

    const result = await resendMails(ctx, ["mail-failed"])

    expect(result).toEqual({ resent: 0, skipped: 1 })
  })
})
