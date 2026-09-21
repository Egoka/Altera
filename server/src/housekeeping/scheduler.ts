import { randomUUID } from "node:crypto"
import type { AppLogger } from "../observability/logger"
import { HOUSEKEEPING_JOB_KIND } from "./housekeeping"
import { RETENTION_POLICY } from "./retention-policy"

export interface HousekeepingQueue {
  hasPending(kind: string): Promise<boolean>
  enqueue(input: { kind: string; manualRetryAllowed: boolean }): Promise<unknown>
}

/**
 * Ставит задание housekeeping в очередь T-047, если такого ещё нет в очереди или в работе.
 * Само удаление выполняет обработчик задания, поэтому сбой видит раздел заданий (`job.failed`).
 */
export async function enqueueHousekeeping(queue: HousekeepingQueue): Promise<boolean> {
  if (await queue.hasPending(HOUSEKEEPING_JOB_KIND)) return false
  await queue.enqueue({ kind: HOUSEKEEPING_JOB_KIND, manualRetryAllowed: true })
  return true
}

export function startHousekeepingSchedule(
  queue: HousekeepingQueue,
  logger: AppLogger,
  intervalMs: number = RETENTION_POLICY.runIntervalMs
): NodeJS.Timeout {
  const run = async () => {
    const requestId = `housekeeping-schedule:${randomUUID()}`
    try {
      await enqueueHousekeeping(queue)
    } catch (error) {
      logger.log({
        level: "error",
        event: "error.unhandled",
        requestId,
        message: "Housekeeping scheduling failed",
        error
      })
    }
  }
  void run()
  const timer = setInterval(() => void run(), intervalMs)
  timer.unref()
  return timer
}
