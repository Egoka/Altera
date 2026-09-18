import { randomUUID } from "node:crypto"
import type { AppLogger } from "../observability/logger"

export const DEFAULT_JOB_MAX_ATTEMPTS = 3
export const DEFAULT_JOB_RETRY_DELAY_MS = 1_000
export const DEFAULT_JOB_STUCK_TIMEOUT_MS = 60 * 60 * 1_000

export interface ClaimedJob {
  id: string
  kind: string
  parameters: unknown
  originRequestId: string | null
  attemptCount: number
  maxAttempts: number
  createdAt: Date
  startedAt: Date | null
}

export interface StuckJob {
  id: string
  kind: string
  originRequestId: string | null
  attemptCount: number
  createdAt: Date
  startedAt: Date
}

export interface JobFailure {
  errorClass: string
  errorRequestId?: string
}

export interface JobStore {
  claimNext(kinds: readonly string[], now: Date): Promise<ClaimedJob | null>
  complete(jobId: string, attemptNumber: number, completedAt: Date): Promise<void>
  reschedule(
    jobId: string,
    attemptNumber: number,
    failure: JobFailure,
    availableAt: Date,
    failedAt: Date
  ): Promise<void>
  fail(jobId: string, attemptNumber: number, failure: JobFailure, failedAt: Date): Promise<boolean>
  markStuck(stuckBefore: Date, markedAt: Date): Promise<readonly StuckJob[]>
}

export type JobHandler = (job: ClaimedJob) => Promise<void>

interface JobWorkerOptions {
  store: JobStore
  logger: AppLogger
  handlers: ReadonlyMap<string, JobHandler>
  now?: () => Date
  retryDelayMs?: number
  stuckTimeoutMs?: number
  pollIntervalMs?: number
}

export interface JobWorker {
  processNext(): Promise<boolean>
  markStuckJobs(): Promise<number>
  start(): void
  stop(): void
}

function toFailure(error: unknown): JobFailure {
  const errorClass = error instanceof Error && error.name ? error.name : "UnknownError"
  const errorRequestId =
    typeof error === "object" && error !== null && "requestId" in error && typeof error.requestId === "string"
      ? error.requestId
      : undefined
  return { errorClass, errorRequestId }
}

function ageSeconds(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1_000))
}

export function createJobWorker(options: JobWorkerOptions): JobWorker {
  const now = options.now ?? (() => new Date())
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_JOB_RETRY_DELAY_MS
  const stuckTimeoutMs = options.stuckTimeoutMs ?? DEFAULT_JOB_STUCK_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? 1_000
  let timer: NodeJS.Timeout | null = null
  let tickInProgress = false

  async function processNext(): Promise<boolean> {
    const kinds = [...options.handlers.keys()]
    if (kinds.length === 0) return false

    const startedAt = now()
    const job = await options.store.claimNext(kinds, startedAt)
    if (!job) return false

    const handler = options.handlers.get(job.kind)
    if (!handler) return false

    try {
      await handler(job)
      await options.store.complete(job.id, job.attemptCount, now())
    } catch (error: unknown) {
      const failedAt = now()
      const failure = toFailure(error)
      if (job.attemptCount >= job.maxAttempts) {
        const transitioned = await options.store.fail(job.id, job.attemptCount, failure, failedAt)
        if (transitioned) {
          options.logger.log({
            level: "error",
            event: "job.failed",
            message: "Background job exhausted its attempts",
            jobId: job.id,
            ...(job.originRequestId ? { originRequestId: job.originRequestId } : {}),
            data: {
              kind: job.kind,
              attempts: job.attemptCount,
              ageSec: ageSeconds(job.createdAt, failedAt)
            }
          })
        }
      } else {
        await options.store.reschedule(
          job.id,
          job.attemptCount,
          failure,
          new Date(failedAt.getTime() + retryDelayMs),
          failedAt
        )
      }
    }
    return true
  }

  async function markStuckJobs(): Promise<number> {
    const markedAt = now()
    const jobs = await options.store.markStuck(new Date(markedAt.getTime() - stuckTimeoutMs), markedAt)
    for (const job of jobs) {
      options.logger.log({
        level: "warn",
        event: "job.stuck",
        message: "Background job exceeded the running timeout",
        jobId: job.id,
        ...(job.originRequestId ? { originRequestId: job.originRequestId } : {}),
        data: {
          kind: job.kind,
          attempts: job.attemptCount,
          ageSec: ageSeconds(job.createdAt, markedAt)
        }
      })
    }
    return jobs.length
  }

  async function tick(): Promise<void> {
    if (tickInProgress) return
    tickInProgress = true
    try {
      await markStuckJobs()
      await processNext()
    } finally {
      tickInProgress = false
    }
  }

  function scheduleTick(): void {
    void tick().catch((error: unknown) => {
      options.logger.log({
        level: "error",
        event: "error.unhandled",
        message: "Background job worker tick failed",
        requestId: randomUUID(),
        error
      })
    })
  }

  return {
    processNext,
    markStuckJobs,
    start() {
      if (timer) return
      timer = setInterval(scheduleTick, pollIntervalMs)
      timer.unref()
      scheduleTick()
    },
    stop() {
      if (!timer) return
      clearInterval(timer)
      timer = null
    }
  }
}
