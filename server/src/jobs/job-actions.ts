import { ensurePermission, type PermissionException, type PermissionUser } from "../exceptions/permissions"
import { createApiError } from "../errors/graphql-error"

export interface JobActionStore {
  retry(jobId: string, actor: PermissionUser, requestId: string, now: Date): Promise<boolean>
  cancel(jobId: string, actor: PermissionUser, requestId: string, reason: string, now: Date): Promise<boolean>
}

interface JobActionOptions {
  store: JobActionStore
  currentUser: PermissionUser | null
  jobId: string
  requestId: string
  exceptions?: readonly PermissionException[]
  reason?: string
  now?: Date
}

async function runJobAction(
  action: "retry" | "cancel",
  permission: "job.retry" | "job.cancel",
  options: JobActionOptions
): Promise<void> {
  const now = options.now ?? new Date()
  ensurePermission(options.currentUser, permission, `job.${action}`, options.requestId, {
    exceptions: options.exceptions,
    now
  })
  const actor = options.currentUser as PermissionUser
  const changed =
    action === "retry"
      ? await options.store.retry(options.jobId, actor, options.requestId, now)
      : await options.store.cancel(options.jobId, actor, options.requestId, options.reason as string, now)
  if (!changed) {
    throw createApiError("CONFLICT", {
      requestId: options.requestId,
      entity: "Job",
      expected: action === "retry" ? "failed_or_stuck" : "queued_or_running",
      actual: "changed"
    })
  }
}

export async function retryJob(options: JobActionOptions): Promise<void> {
  await runJobAction("retry", "job.retry", options)
}

export async function cancelJob(options: JobActionOptions): Promise<void> {
  const reason = options.reason?.trim()
  if (!reason) {
    throw createApiError("VALIDATION_ERROR", {
      requestId: options.requestId,
      field: "reason",
      rule: "required"
    })
  }
  await runJobAction("cancel", "job.cancel", { ...options, reason })
}
