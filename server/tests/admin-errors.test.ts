import { describe, expect, it, vi } from "vitest"
import {
  buildErrorsCsv,
  exportErrors,
  listErrorLog,
  listHealthHistory,
  resolveErrors,
  setErrorWorkStatus,
  type AdminErrorsContext
} from "../src/admin/errors"

const UPDATED_AT = new Date("2026-09-28T10:00:00.000Z")
const NEXT_UPDATED_AT = new Date("2026-09-28T10:05:00.000Z")

const group = {
  id: "error-1",
  signature: "api:INTERNAL_ERROR:graphql:feed",
  service: "api" as const,
  code: "INTERNAL_ERROR",
  errorClass: "Error",
  sanitizedMessage: "Internal server error",
  route: "graphql:feed",
  requestMethod: null,
  requestId: "5f0c2a4e-8b1d-4c3e-9a7f-1b2c3d4e5f60",
  sanitizedStack: "Error: Internal server error\n at resolver",
  actorRole: "reader" as const,
  jobId: null,
  workStatus: "new_record" as const,
  assignedActorId: null,
  assignedActorRole: null,
  firstSeenAt: new Date("2026-09-28T09:00:00.000Z"),
  lastSeenAt: UPDATED_AT,
  occurrenceCount: 3,
  createdAt: new Date("2026-09-28T09:00:00.000Z"),
  updatedAt: UPDATED_AT,
  statusHistory: []
}

function createContext() {
  let current = group
  const createHistory = vi.fn(async () => undefined)
  const createAudit = vi.fn(async () => undefined)

  const prisma = {
    backendError: {
      findUnique: vi.fn(async () => current),
      updateMany: vi.fn(async ({ where, data }: { where: { updatedAt: Date }; data: Record<string, unknown> }) => {
        if (where.updatedAt.getTime() !== current.updatedAt.getTime()) return { count: 0 }
        current = { ...current, ...data, updatedAt: NEXT_UPDATED_AT } as typeof group
        return { count: 1 }
      })
    },
    backendErrorStatusHistory: { create: createHistory },
    auditLog: { create: createAudit },
    $transaction: async <T>(run: (tx: typeof prisma) => Promise<T>) => run(prisma)
  }

  return {
    ctx: {
      prisma,
      currentUser: { id: "admin-1", role: "admin", status: "active" },
      requestId: "9c734584-e8d8-4924-8452-f5f6e8a15313"
    } as unknown as AdminErrorsContext,
    createHistory,
    createAudit
  }
}

describe("T-081 admin error work status", () => {
  it("returns flat pagination and counts occurrences inside the selected period", async () => {
    const firstSeenAt = new Date("2026-09-28T09:30:00.000Z")
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ totalItems: 1 }])
      .mockResolvedValueOnce([
        {
          ...group,
          periodOccurrences: 2,
          periodFirstSeenAt: firstSeenAt,
          periodLastSeenAt: UPDATED_AT
        }
      ])
    const prisma = {
      $queryRaw: queryRaw
    }
    const ctx = {
      prisma,
      currentUser: { id: "admin-1", role: "admin", status: "active" },
      requestId: "req-list"
    } as unknown as AdminErrorsContext

    const result = await listErrorLog(ctx, {
      filters: { period: { from: firstSeenAt.toISOString(), to: NEXT_UPDATED_AT.toISOString() } },
      pagination: { page: 1, limit: 20 }
    })

    expect(result.pagination).toMatchObject({ currentPage: 1, totalItems: 1, totalPages: 1 })
    expect(result.items[0]).toMatchObject({ occurrences: 2, firstSeenAt, lastSeenAt: UPDATED_AT })
    expect(queryRaw).toHaveBeenCalledTimes(2)
    expect(queryRaw.mock.calls[1]?.[0].values.slice(-2)).toEqual([20, 0])
  })

  it("paginates grouped page errors in the database", async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ totalItems: 3 }])
      .mockResolvedValueOnce([
        {
          signature: "web:PAGE_ERROR:/feed",
          service: "web",
          code: "PAGE_ERROR",
          route: "/feed",
          occurrences: 4,
          firstSeenAt: group.firstSeenAt,
          lastSeenAt: group.lastSeenAt
        }
      ])
    const ctx = {
      prisma: { $queryRaw: queryRaw },
      currentUser: { id: "admin-1", role: "admin", status: "active" },
      requestId: "req-page-list"
    } as unknown as AdminErrorsContext

    const result = await listErrorLog(ctx, {
      filters: { stream: "page" },
      pagination: { page: 2, limit: 1 }
    })

    expect(result.pagination).toMatchObject({ currentPage: 2, totalItems: 3, totalPages: 3 })
    expect(result.items[0]).toMatchObject({ stream: "page", occurrences: 4 })
    expect(queryRaw.mock.calls[1]?.[0].values.slice(-2)).toEqual([1, 1])
  })

  it("uses the last known health state when the selected period has no transition", async () => {
    const previous = { id: "health-1", checkedAt: new Date("2026-09-20T10:00:00.000Z") }
    const prisma = {
      systemHealthSnapshot: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => previous)
      }
    }
    const ctx = {
      prisma,
      currentUser: { id: "admin-1", role: "admin", status: "active" },
      requestId: "req-health"
    } as unknown as AdminErrorsContext

    await expect(
      listHealthHistory(ctx, {
        from: "2026-09-27T10:00:00.000Z",
        to: "2026-09-28T10:00:00.000Z"
      })
    ).resolves.toEqual([previous])
  })

  it("runs a bulk status change inside one transaction", async () => {
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]
    const current = new Map(ids.map((id) => [id, { ...group, id }]))
    const transaction = {
      backendError: {
        findMany: vi.fn(async () => ids.map((id) => ({ id, updatedAt: UPDATED_AT }))),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => current.get(where.id)),
        updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const item = current.get(where.id)
          if (item) current.set(where.id, { ...item, ...data, updatedAt: NEXT_UPDATED_AT })
          return { count: 1 }
        })
      },
      backendErrorStatusHistory: { create: vi.fn(async () => undefined) },
      auditLog: { create: vi.fn(async () => undefined) }
    }
    const runTransaction = vi.fn(async <T>(run: (tx: typeof transaction) => Promise<T>) => run(transaction))
    const ctx = {
      prisma: { $transaction: runTransaction },
      currentUser: { id: "admin-1", role: "admin", status: "active" },
      requestId: "req-bulk"
    } as unknown as AdminErrorsContext

    await resolveErrors(ctx, ids)

    expect(runTransaction).toHaveBeenCalledTimes(1)
    expect(transaction.backendError.findMany).toHaveBeenCalledOnce()
  })

  it("writes status history and admin.change in the same transaction", async () => {
    const { ctx, createHistory, createAudit } = createContext()

    const result = await setErrorWorkStatus(ctx, {
      id: group.id,
      status: "in_progress",
      expectedUpdatedAt: UPDATED_AT.toISOString(),
      comment: "Разбираю повторяющийся сбой"
    })

    expect(result.workStatus).toBe("in_progress")
    expect(createHistory).toHaveBeenCalledWith({
      data: expect.objectContaining({
        backendErrorId: group.id,
        fromStatus: "new_record",
        toStatus: "in_progress",
        changedByActorId: "admin-1",
        changedByActorRole: "admin",
        comment: "Разбираю повторяющийся сбой"
      })
    })
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "admin.change",
        actorId: "admin-1",
        entityType: "errorWorkItem",
        entityId: group.id,
        diff: { status: { from: "new", to: "in_progress" }, comment: "Разбираю повторяющийся сбой" }
      })
    })
  })

  it("rejects a stale updatedAt without writing history", async () => {
    const { ctx, createHistory } = createContext()

    await expect(
      setErrorWorkStatus(ctx, {
        id: group.id,
        status: "resolved",
        expectedUpdatedAt: "2026-09-28T09:59:59.000Z"
      })
    ).rejects.toMatchObject({ extensions: expect.objectContaining({ code: "CONFLICT" }) })
    expect(createHistory).not.toHaveBeenCalled()
  })

  it("rejects a transition that bypasses the approved workflow", async () => {
    const { ctx, createHistory, createAudit } = createContext()

    await expect(
      setErrorWorkStatus(ctx, {
        id: group.id,
        status: "new",
        expectedUpdatedAt: UPDATED_AT.toISOString()
      })
    ).rejects.toMatchObject({ extensions: expect.objectContaining({ code: "VALIDATION_ERROR" }) })
    expect(createHistory).not.toHaveBeenCalled()
    expect(createAudit).not.toHaveBeenCalled()
  })

  it("exports only safe operational columns and neutralizes spreadsheet formulas", () => {
    const csv = buildErrorsCsv([
      {
        id: group.id,
        signature: group.signature,
        stream: "backend",
        service: group.service,
        code: '=HYPERLINK("https://invalid.example")',
        route: "+cmd",
        requestId: group.requestId,
        occurrences: group.occurrenceCount,
        workStatus: "new",
        assignedActorId: null,
        assignedActorRole: null,
        firstSeenAt: group.firstSeenAt,
        lastSeenAt: group.lastSeenAt,
        updatedAt: group.updatedAt
      }
    ])

    expect(csv).toContain("'=HYPERLINK")
    expect(csv).toContain("'+cmd")
    expect(csv).not.toContain(group.sanitizedMessage)
    expect(csv).not.toContain(group.sanitizedStack)
  })

  it("applies the CSV row limit in the database query", async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ totalItems: 1 }])
      .mockResolvedValueOnce([
        {
          ...group,
          periodOccurrences: 1,
          periodFirstSeenAt: group.firstSeenAt,
          periodLastSeenAt: group.lastSeenAt
        }
      ])
    const ctx = {
      prisma: {
        $queryRaw: queryRaw,
        auditLog: {
          findMany: vi.fn(async () => []),
          create: vi.fn(async () => undefined)
        }
      },
      currentUser: { id: "admin-1", role: "admin", status: "active" },
      requestId: "req-export"
    } as unknown as AdminErrorsContext

    await exportErrors(ctx, {}, UPDATED_AT)

    expect(queryRaw.mock.calls[1]?.[0].values.slice(-2)).toEqual([1000, 0])
  })
})
