/**
 * Связь AI-проверки с очередью фоновых заданий T-047.
 *
 * Постановка задания и запись AI-процесса в статусе «создано» идут одной транзакцией: задание без
 * записи не попало бы в раздел «AI-процессы», а запись без задания никогда бы не выполнилась.
 * Это точка входа для подачи (`write-and-publish.md` шаг 3, событие `ai.job.created`); сам переход
 * версии в `ai_check` делает T-049.
 */

import type { Prisma, PrismaClient } from "../generated/prisma"
import { DEFAULT_JOB_MAX_ATTEMPTS } from "../jobs/job-worker"
import type { AppLogger } from "../observability/logger"
import { AI_CHECK_OBJECT_TYPE } from "./store"

/** Вид задания уже перечислен в `KNOWN_JOB_KINDS` (`admin/jobs.ts`). */
export const AI_CHECK_JOB_KIND = "ai.check"

export interface AiCheckJobParameters {
  translationId: string
  revisionId: string
}

export interface EnqueueAiCheckInput extends AiCheckJobParameters {
  /** `requestId` подачи: связывает задание с запросом автора в логах. */
  requestId: string
}

export interface EnqueuedAiCheck {
  jobId: string
  aiProcessId: string
}

export interface AiCheckQueue {
  enqueue(input: EnqueueAiCheckInput): Promise<EnqueuedAiCheck>
}

/** Разбор параметров задания: очередь хранит их как JSON, поэтому форма проверяется явно. */
export function parseAiCheckJobParameters(parameters: unknown): AiCheckJobParameters {
  const value = parameters as Partial<AiCheckJobParameters> | null
  if (!value || typeof value.translationId !== "string" || typeof value.revisionId !== "string") {
    throw new Error("ai.check job parameters must contain translationId and revisionId")
  }
  return { translationId: value.translationId, revisionId: value.revisionId }
}

export function createPrismaAiCheckQueue(client: PrismaClient, logger: AppLogger): AiCheckQueue {
  return {
    async enqueue(input) {
      const parameters: Prisma.InputJsonValue = {
        translationId: input.translationId,
        revisionId: input.revisionId
      }

      const enqueued = await client.$transaction(async (transaction) => {
        const job = await transaction.job.create({
          data: {
            kind: AI_CHECK_JOB_KIND,
            parameters,
            objectType: AI_CHECK_OBJECT_TYPE,
            objectId: input.translationId,
            originRequestId: input.requestId,
            maxAttempts: DEFAULT_JOB_MAX_ATTEMPTS,
            // Технический повтор упавшего задания разрешён владельцу (`jobs.md` §5); вердикт
            // при этом не пересматривается — повтор идёт по той же записи проверки.
            manualRetryAllowed: true
          },
          select: { id: true }
        })
        const process = await transaction.aiProcess.create({
          data: {
            jobId: job.id,
            kind: "check",
            status: "created",
            objectType: AI_CHECK_OBJECT_TYPE,
            objectId: input.translationId,
            revisionId: input.revisionId
          },
          select: { id: true }
        })
        return { jobId: job.id, aiProcessId: process.id }
      })

      logger.log({
        level: "info",
        event: "ai.job.created",
        message: "AI check job created",
        jobId: enqueued.jobId,
        originRequestId: input.requestId,
        data: { kind: "check", translationId: input.translationId, revisionId: input.revisionId }
      })

      return enqueued
    }
  }
}
