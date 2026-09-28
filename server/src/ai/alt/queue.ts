/**
 * Связь AI-описания с очередью фоновых заданий T-047.
 *
 * Постановка задания и запись AI-процесса в статусе «создано» идут одной транзакцией: задание без
 * записи не попало бы в раздел «AI-процессы» (`40-admin/ai-processes.md` §1, фильтр «описание
 * изображения»), а запись без задания никогда бы не выполнилась. Точка входа — готовность файла
 * в конвейере загрузки (`upload-pipeline.md` п. 5–6а).
 */

import type { Prisma, PrismaClient } from "../../generated/prisma"
import { DEFAULT_JOB_MAX_ATTEMPTS } from "../../jobs/job-worker"
import type { AppLogger } from "../../observability/logger"

/** Вид задания уже перечислен в `KNOWN_JOB_KINDS` (`admin/jobs.ts`). */
export const AI_ALT_JOB_KIND = "ai.alt"

/** Объект описания — сам медиафайл, а не материал (журнал §29.11, §29.13). */
export const AI_ALT_OBJECT_TYPE = "mediaAsset"

export interface AiAltJobParameters {
  assetId: string
}

export interface EnqueueAiAltInput extends AiAltJobParameters {
  /** `requestId` загрузки, если он дошёл до задания конвейера; иначе связи с запросом нет. */
  requestId: string | null
}

export interface EnqueuedAiAlt {
  jobId: string
  aiProcessId: string
}

export interface AiAltQueue {
  enqueue(input: EnqueueAiAltInput): Promise<EnqueuedAiAlt>
}

/** Разбор параметров задания: очередь хранит их как JSON, поэтому форма проверяется явно. */
export function parseAiAltJobParameters(parameters: unknown): AiAltJobParameters {
  const value = parameters as Partial<AiAltJobParameters> | null
  if (!value || typeof value.assetId !== "string" || value.assetId.length === 0) {
    throw new Error("ai.alt job parameters must contain assetId")
  }
  return { assetId: value.assetId }
}

export function createPrismaAiAltQueue(client: PrismaClient, logger: AppLogger): AiAltQueue {
  return {
    async enqueue(input) {
      const parameters: Prisma.InputJsonValue = { assetId: input.assetId }

      const enqueued = await client.$transaction(async (transaction) => {
        const job = await transaction.job.create({
          data: {
            kind: AI_ALT_JOB_KIND,
            parameters,
            objectType: AI_ALT_OBJECT_TYPE,
            objectId: input.assetId,
            ...(input.requestId ? { originRequestId: input.requestId } : {}),
            maxAttempts: DEFAULT_JOB_MAX_ATTEMPTS,
            // Технический повтор упавшего задания разрешён владельцу (`jobs.md` §5): описание
            // при этом не переписывается — повтор идёт по записи, у которой `alt` ещё пуст.
            manualRetryAllowed: true
          },
          select: { id: true }
        })
        const process = await transaction.aiProcess.create({
          data: {
            jobId: job.id,
            kind: "alt",
            status: "created",
            objectType: AI_ALT_OBJECT_TYPE,
            objectId: input.assetId
          },
          select: { id: true }
        })
        return { jobId: job.id, aiProcessId: process.id }
      })

      logger.log({
        level: "info",
        event: "ai.job.created",
        message: "AI alt job created",
        jobId: enqueued.jobId,
        ...(input.requestId ? { originRequestId: input.requestId } : {}),
        data: { kind: "alt", assetId: input.assetId }
      })

      return enqueued
    }
  }
}
