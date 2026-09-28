import { describe, expect, it, vi } from "vitest"
import { buildErrorsCsv, setErrorWorkStatus, type AdminErrorsContext } from "../src/admin/errors"

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
})
