import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import { answerSupportRequest, getAdminSupportRequest, listAdminSupportRequests } from "../src/admin/support"
import { listMySupportRequests } from "../src/support/requests"
import type { GraphQLContext } from "../src/prisma"

/**
 * Раздел админки «Обращения» и статус обращения в кабинете (T-119, журнал §37 п. 2, 13).
 * Критерий №1 — очередь открывают только `admin` и `owner`; критерий №2 — кабинет показывает
 * статус своего обращения; критерий №3 — ответ пишет `support.request.answered` (events #91).
 */

type ViewerRole = "reader" | "author" | "editor" | "moderator" | "analyst" | "admin" | "owner"

function actor(role: ViewerRole) {
  return { id: `${role}-1`, role, archivedAt: null, planTier: "free", planUntil: null, permissionExceptions: [] }
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: "support-1",
    ticketNo: 101,
    topic: "general",
    email: "reader@example.test",
    message: "Здравствуйте, страница оплаты показала ошибку.",
    path: "/pricing",
    requestId: "req-500",
    locale: "ru",
    createdAt: new Date("2026-09-27T10:00:00.000Z"),
    answeredAt: null,
    userId: "reader-1",
    answeredBy: null,
    ...overrides
  }
}

interface ContextOptions {
  role?: ViewerRole
  currentUser?: null
  rows?: ReturnType<typeof request>[]
  single?: ReturnType<typeof request> | null
}

function context(options: ContextOptions = {}) {
  const rows = options.rows ?? [request()]
  const stored = new Map(rows.map((row) => [row.id, { ...row }]))
  const logs: { event: string; data?: Record<string, unknown>; message?: string }[] = []

  const supportRequest = {
    findMany: vi.fn().mockResolvedValue(rows),
    findUnique: vi.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(options.single === undefined ? (stored.get(where.id) ?? null) : options.single)
    ),
    count: vi.fn().mockResolvedValue(rows.length),
    update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const current = stored.get(where.id)
      if (!current) throw new Error("not found")
      const next = { ...current, ...data }
      stored.set(where.id, next)
      return Promise.resolve(next)
    })
  }
  const auditLog = { create: vi.fn().mockResolvedValue({ id: "audit-1" }) }

  const ctx = {
    currentUser: options.currentUser === null ? null : actor(options.role ?? "admin"),
    requestId: "req-t119",
    logger: { log: (entry: { event: string; data?: Record<string, unknown> }) => logs.push(entry) },
    prisma: { supportRequest, auditLog }
  } as unknown as GraphQLContext

  return { ctx, supportRequest, auditLog, logs, stored }
}

describe("adminSupportRequests", () => {
  it("opens the queue for admin and owner", async () => {
    for (const role of ["admin", "owner"] as const) {
      const { ctx, supportRequest } = context({ role })

      const list = await listAdminSupportRequests(ctx, {})

      expect(list.items).toHaveLength(1)
      expect(list.openCount).toBe(1)
      expect(supportRequest.findMany).toHaveBeenCalled()
    }
  })

  it("refuses the queue to the other service roles and to an account", async () => {
    for (const role of ["editor", "moderator", "analyst", "author", "reader"] as const) {
      const { ctx, supportRequest } = context({ role })

      await expect(listAdminSupportRequests(ctx, {})).rejects.toMatchObject<Partial<GraphQLError>>({
        extensions: { code: "FORBIDDEN", action: "admin.support.read" }
      })
      expect(supportRequest.findMany).not.toHaveBeenCalled()
    }
  })

  it("refuses the queue to a guest", async () => {
    const { ctx } = context({ currentUser: null })

    await expect(listAdminSupportRequests(ctx, {})).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "UNAUTHENTICATED" }
    })
  })

  it("masks the address and hides the message in the list without an audit record", async () => {
    const { ctx, auditLog } = context()

    const list = await listAdminSupportRequests(ctx, {})

    expect(list.items[0]).toMatchObject({
      status: "received",
      email: "r***r@example.test",
      emailMasked: true,
      message: null,
      fromAccount: true
    })
    expect(auditLog.create).not.toHaveBeenCalled()
  })

  it("filters the queue by status and topic", async () => {
    const { ctx, supportRequest } = context()

    await listAdminSupportRequests(ctx, { filters: { status: "received", topic: ["broken_link"] } })

    const where = supportRequest.findMany.mock.calls[0][0].where as { AND: Record<string, unknown>[] }
    expect(where.AND).toContainEqual({ answeredAt: null })
    expect(where.AND).toContainEqual({ topic: { in: ["broken_link"] } })
  })

  it("returns the full address and the message from the card and audits the personal data read", async () => {
    const { ctx, auditLog } = context({ role: "owner" })

    const card = await getAdminSupportRequest(ctx, "support-1")

    expect(card).toMatchObject({
      email: "reader@example.test",
      emailMasked: false,
      message: "Здравствуйте, страница оплаты показала ошибку."
    })
    expect(auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "admin.read.personal",
        actorId: "owner-1",
        actorRole: "owner",
        entityType: "supportRequest",
        entityId: "support-1",
        context: "support",
        purpose: "admin.support.read",
        requestId: "req-t119"
      })
    })
  })

  it("does not audit a card that does not exist", async () => {
    const { ctx, auditLog } = context({ single: null })

    await expect(getAdminSupportRequest(ctx, "missing")).resolves.toBeNull()
    expect(auditLog.create).not.toHaveBeenCalled()
  })
})

describe("answerSupportRequest", () => {
  it("marks the request answered and writes support.request.answered without personal data", async () => {
    const { ctx, logs, stored } = context()

    const answered = await answerSupportRequest(ctx, "support-1")

    expect(answered.status).toBe("answered")
    expect(stored.get("support-1")).toMatchObject({ answeredById: "admin-1" })
    expect(stored.get("support-1")?.answeredAt).toBeInstanceOf(Date)

    // Событие #91: тема и статус; ни адреса, ни текста обращения в записи нет.
    const event = logs.find((entry) => entry.event === "support.request.answered")
    expect(event).toMatchObject({ event: "support.request.answered", data: { topic: "general", status: "answered" } })
    expect(JSON.stringify(event)).not.toContain("reader@example.test")
    expect(JSON.stringify(event)).not.toContain("страница оплаты")
  })

  it("refuses a second answer and keeps the first date", async () => {
    const { ctx, logs, stored } = context()

    await answerSupportRequest(ctx, "support-1")
    const firstAnswer = stored.get("support-1")?.answeredAt

    await expect(answerSupportRequest(ctx, "support-1")).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "CONFLICT", entity: "supportRequest" }
    })
    expect(stored.get("support-1")?.answeredAt).toBe(firstAnswer)
    expect(logs.filter((entry) => entry.event === "support.request.answered")).toHaveLength(1)
  })

  it("answers NOT_FOUND for an unknown request and writes no event", async () => {
    const { ctx, logs } = context({ single: null })

    await expect(answerSupportRequest(ctx, "missing")).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "NOT_FOUND", entity: "supportRequest" }
    })
    expect(logs).toHaveLength(0)
  })

  it("refuses the answer to the other service roles", async () => {
    const { ctx, supportRequest } = context({ role: "moderator" })

    await expect(answerSupportRequest(ctx, "support-1")).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "FORBIDDEN", action: "admin.support.answer" }
    })
    expect(supportRequest.update).not.toHaveBeenCalled()
  })
})

describe("mySupportRequests", () => {
  const store = (rows: ReturnType<typeof request>[]) => ({
    supportRequest: {
      findMany: vi.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve(rows.filter((row) => row.userId === where.userId))
      )
    }
  })

  it("shows own requests with the status the cabinet prints", async () => {
    const rows = [
      request(),
      request({ id: "support-2", ticketNo: 102, answeredAt: new Date("2026-09-28T09:00:00.000Z") }),
      request({ id: "support-3", ticketNo: 103, userId: "other-1" }),
      request({ id: "support-4", ticketNo: 104, userId: null })
    ]
    const fake = store(rows)

    const mine = await listMySupportRequests({
      store: fake as never,
      actor: { id: "reader-1", email: "reader@example.test", role: "reader", locale: "ru", archivedAt: null },
      requestId: "req-t119"
    })

    expect(mine.map((item) => [item.ticketNo, item.status])).toEqual([
      [101, "received"],
      [102, "answered"]
    ])
  })

  it("refuses the cabinet list to a guest", async () => {
    const fake = store([])

    await expect(
      listMySupportRequests({ store: fake as never, actor: null, requestId: "req-t119" })
    ).rejects.toMatchObject<Partial<GraphQLError>>({ extensions: { code: "UNAUTHENTICATED" } })
    expect(fake.supportRequest.findMany).not.toHaveBeenCalled()
  })
})
