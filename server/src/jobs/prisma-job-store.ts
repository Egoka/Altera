import { Prisma, PrismaClient } from "../generated/prisma"
import type { PermissionUser } from "../exceptions/permissions"
import { DEFAULT_JOB_MAX_ATTEMPTS, type ClaimedJob, type JobFailure, type JobStore, type StuckJob } from "./job-worker"
import type { JobActionStore } from "./job-actions"

export interface EnqueueJobInput {
  kind: string
  parameters?: Prisma.InputJsonValue
  objectType?: string
  objectId?: string
  originRequestId?: string
  availableAt?: Date
  maxAttempts?: number
  manualRetryAllowed?: boolean
}

export interface EnqueuedJob {
  id: string
  kind: string
  originRequestId: string | null
}

export interface PrismaJobStore extends JobStore, JobActionStore {
  enqueue(input: EnqueueJobInput): Promise<EnqueuedJob>
}

const claimedJobSelect = {
  id: true,
  kind: true,
  parameters: true,
  originRequestId: true,
  attemptCount: true,
  maxAttempts: true,
  createdAt: true,
  startedAt: true
} satisfies Prisma.JobSelect

function assertMaxAttempts(maxAttempts: number): void {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("maxAttempts must be a positive integer")
  }
}

function failureData(failure: JobFailure): { errorClass: string; errorRequestId: string | null } {
  return {
    errorClass: failure.errorClass.slice(0, 200),
    errorRequestId: failure.errorRequestId ?? null
  }
}

export function createPrismaJobStore(client: PrismaClient): PrismaJobStore {
  return {
    async enqueue(input) {
      const maxAttempts = input.maxAttempts ?? DEFAULT_JOB_MAX_ATTEMPTS
      assertMaxAttempts(maxAttempts)
      return client.job.create({
        data: {
          kind: input.kind,
          parameters: input.parameters,
          objectType: input.objectType,
          objectId: input.objectId,
          originRequestId: input.originRequestId,
          availableAt: input.availableAt,
          maxAttempts,
          manualRetryAllowed: input.kind === "ranking.recompute" ? false : input.manualRetryAllowed
        },
        select: { id: true, kind: true, originRequestId: true }
      })
    },

    async claimNext(kinds, now) {
      if (kinds.length === 0) return null
      return client.$transaction(async (transaction): Promise<ClaimedJob | null> => {
        const candidate = await transaction.job.findFirst({
          where: { status: "queued", availableAt: { lte: now }, kind: { in: [...kinds] } },
          orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
          select: { id: true }
        })
        if (!candidate) return null

        const claimed = await transaction.job.updateMany({
          where: { id: candidate.id, status: "queued", availableAt: { lte: now } },
          data: { status: "running", startedAt: now, finishedAt: null, attemptCount: { increment: 1 } }
        })
        if (claimed.count === 0) return null

        const job = await transaction.job.findUniqueOrThrow({ where: { id: candidate.id }, select: claimedJobSelect })
        await transaction.jobAttempt.create({
          data: {
            jobId: job.id,
            number: job.attemptCount,
            status: "running",
            startedAt: now
          }
        })
        return job
      })
    },

    async complete(jobId, attemptNumber, completedAt) {
      await client.$transaction(async (transaction) => {
        const completed = await transaction.job.updateMany({
          where: { id: jobId, status: "running", attemptCount: attemptNumber },
          data: { status: "completed", finishedAt: completedAt }
        })
        if (completed.count === 0) return
        await transaction.jobAttempt.updateMany({
          where: { jobId, number: attemptNumber, status: "running" },
          data: { status: "completed", finishedAt: completedAt }
        })
      })
    },

    async reschedule(jobId, attemptNumber, failure, availableAt, failedAt) {
      await client.$transaction(async (transaction) => {
        const rescheduled = await transaction.job.updateMany({
          where: { id: jobId, status: "running", attemptCount: attemptNumber },
          data: { status: "queued", startedAt: null, finishedAt: null, availableAt }
        })
        if (rescheduled.count === 0) return
        await transaction.jobAttempt.updateMany({
          where: { jobId, number: attemptNumber, status: "running" },
          data: { status: "failed", finishedAt: failedAt, ...failureData(failure) }
        })
      })
    },

    async fail(jobId, attemptNumber, failure, failedAt) {
      return client.$transaction(async (transaction): Promise<boolean> => {
        const failed = await transaction.job.updateMany({
          where: { id: jobId, status: "running", attemptCount: attemptNumber },
          data: { status: "failed", finishedAt: failedAt }
        })
        if (failed.count === 0) return false
        await transaction.jobAttempt.updateMany({
          where: { jobId, number: attemptNumber, status: "running" },
          data: { status: "failed", finishedAt: failedAt, ...failureData(failure) }
        })
        return true
      })
    },

    async markStuck(stuckBefore, markedAt) {
      return client.$transaction(async (transaction): Promise<StuckJob[]> => {
        const candidates = await transaction.job.findMany({
          where: { status: "running", startedAt: { lte: stuckBefore } },
          take: 100,
          select: {
            id: true,
            kind: true,
            originRequestId: true,
            attemptCount: true,
            createdAt: true,
            startedAt: true
          }
        })
        const stuck: StuckJob[] = []
        for (const job of candidates) {
          const changed = await transaction.job.updateMany({
            where: { id: job.id, status: "running", startedAt: { lte: stuckBefore } },
            data: { status: "stuck", finishedAt: markedAt }
          })
          if (changed.count === 0 || !job.startedAt) continue
          await transaction.jobAttempt.updateMany({
            where: { jobId: job.id, number: job.attemptCount, status: "running" },
            data: { status: "stuck", finishedAt: markedAt }
          })
          stuck.push({ ...job, startedAt: job.startedAt })
        }
        return stuck
      })
    },

    async retry(jobId, actor, requestId, now) {
      return client.$transaction(async (transaction): Promise<boolean> => {
        const job = await transaction.job.findUnique({
          where: { id: jobId },
          select: { status: true, kind: true, attemptCount: true, manualRetryAllowed: true }
        })
        if (
          !job ||
          (job.status !== "failed" && job.status !== "stuck") ||
          job.kind === "ranking.recompute" ||
          !job.manualRetryAllowed
        )
          return false

        const changed = await transaction.job.updateMany({
          where: { id: jobId, status: job.status },
          data: {
            status: "queued",
            availableAt: now,
            startedAt: null,
            finishedAt: null,
            cancelledAt: null,
            maxAttempts: job.attemptCount + DEFAULT_JOB_MAX_ATTEMPTS
          }
        })
        if (changed.count === 0) return false
        await writeActionAudit(transaction, "job.retry", jobId, job.kind, actor, requestId)
        return true
      })
    },

    async cancel(jobId, actor, requestId, reason, now) {
      return client.$transaction(async (transaction): Promise<boolean> => {
        const job = await transaction.job.findUnique({ where: { id: jobId }, select: { status: true, kind: true } })
        if (!job || (job.status !== "queued" && job.status !== "running")) return false

        const changed = await transaction.job.updateMany({
          where: { id: jobId, status: job.status },
          data: { status: "cancelled", cancelledAt: now, finishedAt: now }
        })
        if (changed.count === 0) return false
        await transaction.jobAttempt.updateMany({
          where: { jobId, status: "running" },
          data: { status: "cancelled", finishedAt: now }
        })
        await writeActionAudit(transaction, "job.cancel", jobId, job.kind, actor, requestId, reason)
        return true
      })
    }
  }
}

async function writeActionAudit(
  transaction: Prisma.TransactionClient,
  action: "job.retry" | "job.cancel",
  jobId: string,
  kind: string,
  actor: PermissionUser,
  requestId: string,
  reason?: string
): Promise<void> {
  await transaction.auditLog.create({
    data: {
      action,
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "Job",
      entityId: jobId,
      diff: { jobId, kind, ...(reason ? { reason } : {}) },
      requestId
    }
  })
}
