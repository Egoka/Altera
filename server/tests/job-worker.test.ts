import { describe, expect, it, vi } from "vitest"
import type { AppLogger } from "../src/observability/logger"
import { createJobWorker, type ClaimedJob, type JobFailure, type JobStore, type StuckJob } from "../src/jobs/job-worker"

const HOUR_MS = 60 * 60 * 1000

interface FakeJob extends ClaimedJob {
  status: "queued" | "running" | "completed" | "failed" | "stuck"
  availableAt: Date
  failures: JobFailure[]
}

class FakeJobStore implements JobStore {
  constructor(readonly jobs: FakeJob[]) {}

  async claimNext(kinds: readonly string[], now: Date): Promise<ClaimedJob | null> {
    const job = this.jobs.find(
      (candidate) =>
        candidate.status === "queued" &&
        candidate.availableAt.getTime() <= now.getTime() &&
        kinds.includes(candidate.kind)
    )
    if (!job) return null

    job.status = "running"
    job.startedAt = now
    job.attemptCount += 1
    return { ...job }
  }

  async complete(jobId: string): Promise<void> {
    this.job(jobId).status = "completed"
  }

  async reschedule(jobId: string, _attemptNumber: number, failure: JobFailure, availableAt: Date): Promise<void> {
    const job = this.job(jobId)
    job.status = "queued"
    job.startedAt = null
    job.availableAt = availableAt
    job.failures.push(failure)
  }

  async fail(jobId: string, _attemptNumber: number, failure: JobFailure): Promise<boolean> {
    const job = this.job(jobId)
    if (job.status !== "running") return false
    job.status = "failed"
    job.failures.push(failure)
    return true
  }

  async markStuck(stuckBefore: Date): Promise<readonly StuckJob[]> {
    return this.jobs
      .filter((job) => job.status === "running" && job.startedAt && job.startedAt.getTime() <= stuckBefore.getTime())
      .map((job) => {
        job.status = "stuck"
        return {
          id: job.id,
          kind: job.kind,
          attemptCount: job.attemptCount,
          originRequestId: job.originRequestId,
          createdAt: job.createdAt,
          startedAt: job.startedAt as Date
        }
      })
  }

  private job(id: string): FakeJob {
    const job = this.jobs.find((candidate) => candidate.id === id)
    if (!job) throw new Error(`Unknown fake job: ${id}`)
    return job
  }
}

function queuedJob(overrides: Partial<FakeJob> = {}): FakeJob {
  return {
    id: "job-1",
    kind: "test.fail",
    parameters: { objectId: "article-1" },
    originRequestId: "request-1",
    attemptCount: 0,
    maxAttempts: 2,
    createdAt: new Date("2026-09-18T08:00:00.000Z"),
    startedAt: null,
    status: "queued",
    availableAt: new Date("2026-09-18T08:00:00.000Z"),
    failures: [],
    ...overrides
  }
}

describe("job worker", () => {
  it("после исчерпания попыток переводит задание в failed и пишет job.failed", async () => {
    const now = new Date("2026-09-18T08:05:00.000Z")
    const job = queuedJob()
    const store = new FakeJobStore([job])
    const log = vi.fn<AppLogger["log"]>()
    const worker = createJobWorker({
      store,
      logger: { log },
      handlers: new Map([["test.fail", async () => Promise.reject(new TypeError("provider failed"))]]),
      now: () => now,
      retryDelayMs: 0
    })

    await expect(worker.processNext()).resolves.toBe(true)
    expect(job.status).toBe("queued")
    await expect(worker.processNext()).resolves.toBe(true)

    expect(job.status).toBe("failed")
    expect(job.attemptCount).toBe(2)
    expect(job.failures).toEqual([
      { errorClass: "TypeError", errorRequestId: undefined },
      { errorClass: "TypeError", errorRequestId: undefined }
    ])
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith({
      level: "error",
      event: "job.failed",
      message: "Background job exhausted its attempts",
      jobId: "job-1",
      originRequestId: "request-1",
      data: { kind: "test.fail", attempts: 2, ageSec: 300 }
    })
  })

  it("помечает выполняющееся дольше часа задание как stuck с подменой времени", async () => {
    const startedAt = new Date("2026-09-18T08:00:00.000Z")
    const now = new Date(startedAt.getTime() + HOUR_MS + 5_000)
    const job = queuedJob({ status: "running", startedAt, attemptCount: 1 })
    const store = new FakeJobStore([job])
    const log = vi.fn<AppLogger["log"]>()
    const worker = createJobWorker({
      store,
      logger: { log },
      handlers: new Map(),
      now: () => now
    })

    await expect(worker.markStuckJobs()).resolves.toBe(1)

    expect(job.status).toBe("stuck")
    expect(log).toHaveBeenCalledWith({
      level: "warn",
      event: "job.stuck",
      message: "Background job exceeded the running timeout",
      jobId: "job-1",
      originRequestId: "request-1",
      data: { kind: "test.fail", attempts: 1, ageSec: 3605 }
    })
  })

  it("не пишет job.failed, если конкурентная смена статуса опередила ошибку обработчика", async () => {
    const job = queuedJob({ maxAttempts: 1 })
    const store = new FakeJobStore([job])
    const log = vi.fn<AppLogger["log"]>()
    const worker = createJobWorker({
      store,
      logger: { log },
      handlers: new Map([
        [
          "test.fail",
          async () => {
            job.status = "stuck"
            throw new Error("late failure")
          }
        ]
      ]),
      now: () => new Date("2026-09-18T08:05:00.000Z")
    })

    await worker.processNext()

    expect(job.status).toBe("stuck")
    expect(log).not.toHaveBeenCalled()
  })
})
