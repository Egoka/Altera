import { randomUUID } from "node:crypto"
import type { PrismaClient } from "../generated/prisma"
import type { AppLogger } from "../observability/logger"
import type { PrismaJobStore } from "./prisma-job-store"

// Обслуживающее задание ставится по расписанию, а выполняет его очередь T-047: сбой виден в
// разделе «Задания» (`job.failed`), а не в отдельном сторожевом таймере. Расписаний в проекте
// два и больше (`housekeeping`, `media.purge`), поэтому постановка описана здесь один раз.

export interface RecurringJobQueue {
  hasPending(kind: string): Promise<boolean>
  enqueue(input: { kind: string; manualRetryAllowed: boolean }): Promise<unknown>
}

export function createRecurringJobQueue(client: PrismaClient, store: PrismaJobStore): RecurringJobQueue {
  return {
    async hasPending(kind) {
      return (await client.job.count({ where: { kind, status: { in: ["queued", "running"] } } })) > 0
    },
    enqueue: (input) => store.enqueue(input)
  }
}

/**
 * Ставит задание вида `kind`, если такого ещё нет в очереди или в работе: расписание не должно
 * копить задания, пока предыдущее выполняется дольше периода.
 */
export async function enqueueRecurringJob(queue: RecurringJobQueue, kind: string): Promise<boolean> {
  if (await queue.hasPending(kind)) return false
  await queue.enqueue({ kind, manualRetryAllowed: true })
  return true
}

export interface RecurringJobScheduleOptions {
  queue: RecurringJobQueue
  kind: string
  logger: AppLogger
  intervalMs: number
  /** Сообщение в журнал, когда не удалось поставить задание (сама постановка, не выполнение). */
  failureMessage: string
}

export function startRecurringJobSchedule(options: RecurringJobScheduleOptions): NodeJS.Timeout {
  const run = async () => {
    const requestId = `${options.kind}-schedule:${randomUUID()}`
    try {
      await enqueueRecurringJob(options.queue, options.kind)
    } catch (error) {
      options.logger.log({
        level: "error",
        event: "error.unhandled",
        requestId,
        message: options.failureMessage,
        error
      })
    }
  }
  void run()
  const timer = setInterval(() => void run(), options.intervalMs)
  timer.unref()
  return timer
}
