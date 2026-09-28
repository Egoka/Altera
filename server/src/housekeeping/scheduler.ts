import { enqueueRecurringJob, startRecurringJobSchedule, type RecurringJobQueue } from "../jobs/recurring"
import type { AppLogger } from "../observability/logger"
import { HOUSEKEEPING_JOB_KIND } from "./housekeeping"
import { RETENTION_POLICY } from "./retention-policy"

export type HousekeepingQueue = RecurringJobQueue

/**
 * Ставит задание housekeeping в очередь T-047, если такого ещё нет в очереди или в работе.
 * Само удаление выполняет обработчик задания, поэтому сбой видит раздел заданий (`job.failed`).
 */
export function enqueueHousekeeping(queue: HousekeepingQueue): Promise<boolean> {
  return enqueueRecurringJob(queue, HOUSEKEEPING_JOB_KIND)
}

export function startHousekeepingSchedule(
  queue: HousekeepingQueue,
  logger: AppLogger,
  intervalMs: number = RETENTION_POLICY.runIntervalMs
): NodeJS.Timeout {
  return startRecurringJobSchedule({
    queue,
    kind: HOUSEKEEPING_JOB_KIND,
    logger,
    intervalMs,
    failureMessage: "Housekeeping scheduling failed"
  })
}
