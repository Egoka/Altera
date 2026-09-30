import { describe, expect, it, vi } from "vitest"
import { createPrismaErrorHistory, type ErrorHistoryClient, type ErrorOccurrence } from "../src/error-collector"

const occurrence: ErrorOccurrence = {
  event: "error.unhandled",
  stream: "backend",
  service: "api",
  code: "INTERNAL_ERROR",
  route: "graphql:feed",
  requestId: "5f0c2a4e-8b1d-4c3e-9a7f-1b2c3d4e5f60",
  jobId: null,
  errorType: "Error",
  message: "Internal server error",
  stack: "Error: Internal server error\n at resolver",
  signature: "api:INTERNAL_ERROR:graphql:feed",
  occurredAt: new Date("2026-09-28T10:00:00.000Z")
}

describe("T-081 error work projection", () => {
  it("reopens a resolved group when a new occurrence is appended", async () => {
    const createEvent = vi.fn(async () => undefined)
    const updateGroup = vi.fn(async () => [{ id: "error-1" }])
    const upsertGroup = vi.fn(async () => undefined)
    const createHistory = vi.fn(async () => undefined)
    const tx = {
      backendErrorEvent: { create: createEvent },
      backendError: {
        updateManyAndReturn: updateGroup,
        upsert: upsertGroup
      },
      backendErrorStatusHistory: { create: createHistory }
    }
    const client = {
      ...tx,
      $transaction: async <T>(run: (transaction: typeof tx) => Promise<T>) => run(tx)
    } as unknown as ErrorHistoryClient

    await createPrismaErrorHistory(client).append(occurrence)

    expect(createEvent).toHaveBeenCalledWith({ data: occurrence })
    expect(updateGroup).toHaveBeenCalledWith({
      where: { signature: occurrence.signature, workStatus: "resolved" },
      data: expect.objectContaining({
        workStatus: "new_record",
        assignedActorId: null,
        assignedActorRole: null,
        lastSeenAt: occurrence.occurredAt,
        occurrenceCount: { increment: 1 }
      }),
      select: { id: true }
    })
    expect(createHistory).toHaveBeenCalledWith({
      data: expect.objectContaining({
        backendErrorId: "error-1",
        fromStatus: "resolved",
        toStatus: "new_record",
        changedByActorId: "system:error-collector",
        changedByActorRole: null
      })
    })
    expect(upsertGroup).not.toHaveBeenCalled()
  })

  it("uses an atomic upsert when the signature is not resolved", async () => {
    const upsertGroup = vi.fn(async () => undefined)
    const tx = {
      backendErrorEvent: { create: vi.fn(async () => undefined) },
      backendError: { updateManyAndReturn: vi.fn(async () => []), upsert: upsertGroup },
      backendErrorStatusHistory: { create: vi.fn(async () => undefined) }
    }
    const client = {
      ...tx,
      $transaction: async <T>(run: (transaction: typeof tx) => Promise<T>) => run(tx)
    } as unknown as ErrorHistoryClient

    await createPrismaErrorHistory(client).append(occurrence)

    expect(upsertGroup).toHaveBeenCalledWith({
      where: { signature: occurrence.signature },
      create: expect.objectContaining({ signature: occurrence.signature, occurrenceCount: 1 }),
      update: expect.objectContaining({ occurrenceCount: { increment: 1 } })
    })
  })

  it("does not create a work item for the page-error stream", async () => {
    const upsertGroup = vi.fn(async () => undefined)
    const tx = {
      backendErrorEvent: { create: vi.fn(async () => undefined) },
      backendError: { updateManyAndReturn: vi.fn(), upsert: upsertGroup },
      backendErrorStatusHistory: { create: vi.fn(async () => undefined) }
    }
    const client = {
      ...tx,
      $transaction: async <T>(run: (transaction: typeof tx) => Promise<T>) => run(tx)
    } as unknown as ErrorHistoryClient

    await createPrismaErrorHistory(client).append({
      ...occurrence,
      event: "page.error",
      stream: "page",
      service: "web"
    })

    expect(tx.backendError.updateManyAndReturn).not.toHaveBeenCalled()
    expect(upsertGroup).not.toHaveBeenCalled()
  })
})
