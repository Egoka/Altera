/**
 * Сборка шага AI-описания: адаптер, запись результата и обработчик задания очереди.
 *
 * Объём T-067 — задание, адаптер модели с `fake` и мутация исправления администратором.
 * Выбор модели, языки, стоимость и поведение при ошибке генерации — отдельный проход
 * (`85-media-and-binary/upload-pipeline.md` п. 6а).
 */

import type { PrismaClient } from "../../generated/prisma"
import { registerJobHandler } from "../../jobs/job-handlers"
import type { JobHandler } from "../../jobs/job-worker"
import type { AppLogger } from "../../observability/logger"
import type { ObjectStorage } from "../../storage/types"
import { AI_ALT_JOB_KIND, parseAiAltJobParameters } from "./queue"
import { createAiAltService } from "./service"
import { createPrismaAiAltStore } from "./store"
import type { AiAltAdapter } from "./types"

export { createAiAltAdapterFromEnv } from "./config"
export {
  createFakeAiAltAdapter,
  FakeAiAltUnavailableError,
  type FakeAiAltAdapter,
  type FakeAiAltFixture
} from "./adapters/fake"
export { AiAltProviderNotConfiguredError, createUnavailableAiAltAdapter } from "./adapters/unavailable"
export {
  AI_ALT_JOB_KIND,
  AI_ALT_OBJECT_TYPE,
  createPrismaAiAltQueue,
  parseAiAltJobParameters,
  type AiAltQueue,
  type EnqueueAiAltInput
} from "./queue"
export { createAiAltService, type AiAltOutcome, type AiAltService, type RunAiAltInput } from "./service"
export { createPrismaAiAltStore, type AiAltAssetRecord, type AiAltProcessRecord, type AiAltStore } from "./store"
export type { AiAltAdapter, AiAltImage, AiAltResult } from "./types"

interface AiAltJobOptions {
  client: PrismaClient
  storage: Pick<ObjectStorage, "get">
  adapter: AiAltAdapter
  logger: AppLogger
}

/** Обработчик задания `ai.alt`: параметры очереди → описание и его запись. */
export function createAiAltJobHandler(options: AiAltJobOptions): JobHandler {
  const service = createAiAltService({
    store: createPrismaAiAltStore(options.client),
    storage: options.storage,
    adapter: options.adapter,
    logger: options.logger
  })

  return async (job) => {
    const { assetId } = parseAiAltJobParameters(job.parameters)
    await service.describe({ jobId: job.id, assetId, originRequestId: job.originRequestId })
  }
}

export function registerAiAltJob(options: AiAltJobOptions): void {
  registerJobHandler(AI_ALT_JOB_KIND, createAiAltJobHandler(options))
}
