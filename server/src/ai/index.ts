/**
 * Сборка AI-проверки: адаптер, запись результата и обработчик задания очереди.
 *
 * Объём T-048 — интерфейс, `fake`, запись результата и связь с очередью (журнал §32 п. 3).
 */

import type { PrismaClient } from "../generated/prisma"
import { registerJobHandler } from "../jobs/job-handlers"
import type { JobHandler } from "../jobs/job-worker"
import type { AppLogger } from "../observability/logger"
import { AI_CHECK_JOB_KIND, parseAiCheckJobParameters } from "./queue"
import { createAiCheckService } from "./service"
import { createPrismaAiCheckStore } from "./store"
import type { AiCheckAdapter } from "./types"

export { createAiCheckAdapterFromEnv } from "./config"
export { createFakeAiCheckAdapter, type FakeAiCheckAdapter, type FakeAiCheckFixture } from "./adapters/fake"
export { createUnavailableAiCheckAdapter } from "./adapters/unavailable"
export {
  AI_CHECK_JOB_KIND,
  createPrismaAiCheckQueue,
  enqueueAiCheck,
  parseAiCheckJobParameters,
  type AiCheckQueue,
  type EnqueueAiCheckInput
} from "./queue"
export { aiCheckCategoryTitle, renderAiDecisionComment } from "./reasons"
export { createAiCheckService, aiCostBucket, type AiCheckService, type AiCheckOutcome } from "./service"
export { AI_CHECK_OBJECT_TYPE, createPrismaAiCheckStore, type AiCheckStore } from "./store"
export {
  AI_CHECK_REASON_CATEGORIES,
  aiProviderUnavailableError,
  isAiCheckReasonCategory,
  type AiCheckAdapter,
  type AiCheckReason,
  type AiCheckReasonCategory,
  type AiCheckResult,
  type AiCheckSubmission,
  type AiCheckVerdict
} from "./types"
export { AI_CHECK_SOURCE_SELECT, buildAiCheckSubmission, loadAiCheckSource, type AiCheckSource } from "./submission"

interface AiCheckJobOptions {
  client: PrismaClient
  adapter: AiCheckAdapter
  logger: AppLogger
}

/** Обработчик задания `ai.check`: параметры очереди → вердикт и его запись. */
export function createAiCheckJobHandler(options: AiCheckJobOptions): JobHandler {
  const service = createAiCheckService({
    store: createPrismaAiCheckStore(options.client),
    adapter: options.adapter,
    logger: options.logger
  })

  return async (job) => {
    const { translationId, revisionId } = parseAiCheckJobParameters(job.parameters)
    await service.runCheck({ jobId: job.id, translationId, revisionId, originRequestId: job.originRequestId })
  }
}

export function registerAiCheckJob(options: AiCheckJobOptions): void {
  registerJobHandler(AI_CHECK_JOB_KIND, createAiCheckJobHandler(options))
}
