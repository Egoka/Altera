import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import type { PermissionException, PermissionUser } from "../src/exceptions/permissions"
import { cancelJob, retryJob, type JobActionStore } from "../src/jobs/job-actions"

const NOW = new Date("2026-09-18T09:00:00.000Z")

const user = (role: PermissionUser["role"]): PermissionUser => ({
  id: `${role}-1`,
  role,
  archivedAt: null,
  planTier: "free",
  planUntil: null
})

function store() {
  return {
    retry: vi.fn<JobActionStore["retry"]>().mockResolvedValue(true),
    cancel: vi.fn<JobActionStore["cancel"]>().mockResolvedValue(true)
  }
}

describe("job actions", () => {
  it("разрешает owner повторить и отменить задание", async () => {
    const actions = store()

    await retryJob({ store: actions, currentUser: user("owner"), jobId: "job-1", requestId: "req-1", now: NOW })
    await cancelJob({
      store: actions,
      currentUser: user("owner"),
      jobId: "job-2",
      requestId: "req-1",
      reason: "duplicate",
      now: NOW
    })

    expect(actions.retry).toHaveBeenCalledWith("job-1", user("owner"), "req-1", NOW)
    expect(actions.cancel).toHaveBeenCalledWith("job-2", user("owner"), "req-1", "duplicate", NOW)
  })

  it("запрещает admin действия без исключения", async () => {
    const actions = store()

    await expect(
      retryJob({ store: actions, currentUser: user("admin"), jobId: "job-1", requestId: "req-1", now: NOW })
    ).rejects.toMatchObject<Partial<GraphQLError>>({ extensions: { code: "FORBIDDEN" } })
    await expect(
      cancelJob({
        store: actions,
        currentUser: user("admin"),
        jobId: "job-1",
        requestId: "req-1",
        reason: "duplicate",
        now: NOW
      })
    ).rejects.toMatchObject<Partial<GraphQLError>>({ extensions: { code: "FORBIDDEN" } })
    expect(actions.retry).not.toHaveBeenCalled()
    expect(actions.cancel).not.toHaveBeenCalled()
  })

  it("учитывает отдельные активные исключения job.retry и job.cancel", async () => {
    const actions = store()
    const exceptions: PermissionException[] = ["job.retry", "job.cancel"].map((permission) => ({
      userId: "admin-1",
      role: "admin",
      permission: permission as PermissionException["permission"],
      kind: "grant",
      startsAt: new Date("2026-09-17T00:00:00.000Z"),
      endsAt: null,
      revokedAt: null
    }))

    await retryJob({
      store: actions,
      currentUser: user("admin"),
      jobId: "job-1",
      requestId: "req-1",
      exceptions,
      now: NOW
    })
    await cancelJob({
      store: actions,
      currentUser: user("admin"),
      jobId: "job-1",
      requestId: "req-1",
      reason: "duplicate",
      exceptions,
      now: NOW
    })

    expect(actions.retry).toHaveBeenCalledOnce()
    expect(actions.cancel).toHaveBeenCalledOnce()
  })

  it("требует причину отмены до обращения к хранилищу", async () => {
    const actions = store()

    await expect(
      cancelJob({ store: actions, currentUser: user("owner"), jobId: "job-1", requestId: "req-1", reason: " " })
    ).rejects.toMatchObject<Partial<GraphQLError>>({ extensions: { code: "VALIDATION_ERROR" } })
    expect(actions.cancel).not.toHaveBeenCalled()
  })
})
