import { describe, expect, it, vi } from "vitest"
import type { Prisma } from "../src/generated/prisma"
import {
  enqueueHousekeeping,
  HOUSEKEEPING_JOB_KIND,
  RETENTION_POLICY,
  runHousekeeping,
  type HousekeepingClient,
  type HousekeepingQueue
} from "../src/housekeeping"

const NOW = new Date("2026-09-21T03:00:00.000Z")
const daysBefore = (days: number): Date => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

function fakeClient() {
  const deleteMany = () => vi.fn<(args: { where: object }) => Promise<{ count: number }>>(async () => ({ count: 1 }))
  const client = {
    session: { deleteMany: deleteMany() },
    magicLinkToken: { deleteMany: deleteMany() },
    emailChangeRequest: { deleteMany: deleteMany() },
    backendError: { deleteMany: deleteMany() },
    backendErrorEvent: { deleteMany: deleteMany() },
    $executeRaw: vi.fn<(query: Prisma.Sql) => Promise<number>>(async () => 2)
  }
  return client satisfies HousekeepingClient
}

describe("T-090 housekeeping", () => {
  it("удаляет по срокам из единой политики и возвращает счётчики", async () => {
    const client = fakeClient()

    const result = await runHousekeeping(client, NOW)

    expect(client.session.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: daysBefore(RETENTION_POLICY.sessionAfterExpiryDays) } }
    })
    expect(client.magicLinkToken.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: NOW } }] }
    })
    expect(client.emailChangeRequest.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: NOW } } })
    expect(client.backendError.deleteMany).toHaveBeenCalledWith({
      where: { lastSeenAt: { lt: daysBefore(RETENTION_POLICY.backendErrorDays) }, statusHistory: { none: {} } }
    })
    expect(client.backendErrorEvent.deleteMany).toHaveBeenCalledWith({
      where: { event: "page.error", occurredAt: { lt: daysBefore(RETENTION_POLICY.pageErrorEventDays) } }
    })
    expect(client.backendErrorEvent.deleteMany).toHaveBeenCalledWith({
      where: { event: { not: "page.error" }, occurredAt: { lt: daysBefore(RETENTION_POLICY.backendErrorDays) } }
    })
    const revisionQuery = client.$executeRaw.mock.calls[0][0]
    expect(revisionQuery.sql).toContain(`r."kind" = 'autosave'`)
    expect(revisionQuery.values).toEqual([daysBefore(RETENTION_POLICY.autosaveRevisionDays)])
    expect(result).toEqual({
      sessions: 1,
      magicLinkTokens: 1,
      emailChangeRequests: 1,
      autosaveRevisions: 2,
      backendErrors: 1,
      errorEvents: 2
    })
  })

  it("берёт сроки из переданной политики, а не из собственных чисел", async () => {
    const client = fakeClient()

    await runHousekeeping(client, NOW, {
      ...RETENTION_POLICY,
      sessionAfterExpiryDays: 7,
      backendErrorDays: 1,
      pageErrorEventDays: 2
    })

    expect(client.session.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: daysBefore(7) } } })
    expect(client.backendError.deleteMany).toHaveBeenCalledWith({
      where: { lastSeenAt: { lt: daysBefore(1) }, statusHistory: { none: {} } }
    })
    expect(client.backendErrorEvent.deleteMany).toHaveBeenCalledWith({
      where: { event: "page.error", occurredAt: { lt: daysBefore(2) } }
    })
    expect(client.backendErrorEvent.deleteMany).toHaveBeenCalledWith({
      where: { event: { not: "page.error" }, occurredAt: { lt: daysBefore(1) } }
    })
  })

  it("не ставит второе задание, пока первое в очереди или в работе", async () => {
    const enqueue = vi.fn(async () => ({}))
    const pending: HousekeepingQueue = { hasPending: async () => true, enqueue }
    const idle: HousekeepingQueue = { hasPending: async () => false, enqueue }

    expect(await enqueueHousekeeping(pending)).toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
    expect(await enqueueHousekeeping(idle)).toBe(true)
    expect(enqueue).toHaveBeenCalledWith({ kind: HOUSEKEEPING_JOB_KIND, manualRetryAllowed: true })
  })
})
