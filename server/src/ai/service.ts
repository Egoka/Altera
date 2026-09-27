/**
 * Запись результата AI-проверки (T-048).
 *
 * Что пишется на один вердикт: запись AI-процесса со статусом и причинами
 * (`docs/spec/40-admin/ai-processes.md` §3), агрегат стоимости за период (§27.4 — у отдельной
 * записи стоимости нет), комментарий автору в историю решений при отказе
 * (`30-account/author/review-history.md` §4) и аудит `ai.decision` (реестр #71).
 *
 * Чего сервис **не** делает: не меняет статус версии статьи. Переходы `ai_check` → `published`
 * или `review` — задача T-049; проверка только выносит и записывает вердикт.
 */

import { randomUUID } from "node:crypto"
import type { Prisma, Locale } from "../generated/prisma"
import type { AppLogger } from "../observability/logger"
import { renderAiDecisionComment } from "./reasons"
import { buildAiCheckSubmission, loadAiCheckSource } from "./submission"
import { AI_CHECK_OBJECT_TYPE, type AiCheckStore } from "./store"
import {
  aiProviderUnavailableError,
  type AiCheckAdapter,
  type AiCheckResult,
  type AiCheckSubmission,
  type AiCheckVerdict
} from "./types"

export interface RunAiCheckInput {
  jobId: string
  translationId: string
  revisionId: string
  /** `requestId` подачи, если он известен очереди. */
  originRequestId?: string | null
}

export interface AiCheckOutcome {
  aiProcessId: string
  /** `null` — вердикт уже был вынесен ранее и второй раз не выносится (журнал #14). */
  verdict: AiCheckVerdict | null
}

export interface AiCheckService {
  runCheck(input: RunAiCheckInput): Promise<AiCheckOutcome>
}

interface AiCheckServiceOptions {
  store: AiCheckStore
  adapter: AiCheckAdapter
  logger: AppLogger
  now?: () => Date
}

const errorClassPattern = /^[A-Z][A-Za-z0-9_]{1,63}$/

/** Класс ошибки без сообщения: сообщение провайдера может содержать текст подачи. */
function errorClassOf(error: unknown): string {
  const name = error instanceof Error ? error.name : ""
  if (errorClassPattern.test(name)) return name
  return error instanceof Error ? error.constructor.name : "UnknownError"
}

/**
 * Суточная корзина агрегата в UTC `[ДОПУЩЕНИЕ]`: `AiCostAggregate` требует границ периода, а
 * спецификация величину корзины не задаёт — раздел показывает стоимость «за период» (§27.4).
 */
export function aiCostBucket(at: Date): { bucketStart: Date; bucketEnd: Date } {
  const bucketStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  return { bucketStart, bucketEnd: new Date(bucketStart.getTime() + 24 * 60 * 60 * 1_000) }
}

function reasonsJson(result: AiCheckResult): Prisma.InputJsonValue {
  return result.reasons.map((reason) => ({ category: reason.category, text: reason.text }))
}

function evidenceJson(result: AiCheckResult): Prisma.InputJsonValue {
  return result.evidence.map((item) => ({ category: item.category, fragment: item.fragment }))
}

export function createAiCheckService(options: AiCheckServiceOptions): AiCheckService {
  const { store, adapter, logger } = options
  const now = options.now ?? (() => new Date())

  async function markFailed(
    processId: string,
    jobId: string,
    originRequestId: string | null,
    startedAt: Date,
    error: unknown
  ): Promise<void> {
    const errorClass = errorClassOf(error)
    const finishedAt = now()
    await store.updateProcess(processId, {
      status: "failed",
      providerErrorClass: errorClass,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime()
    })
    logger.log({
      level: "error",
      event: "ai.job.failed",
      message: "AI check job failed",
      jobId,
      ...(originRequestId ? { originRequestId } : {}),
      data: { kind: "check", provider: adapter.name, errorClass }
    })
  }

  async function writeResult(write: {
    processId: string
    input: RunAiCheckInput
    locale: Locale
    result: AiCheckResult
    finishedAt: Date
    durationMs: number
    originRequestId: string | null
  }): Promise<void> {
    const { result } = write
    const bucket = aiCostBucket(write.finishedAt)

    await store.writeResult(async (writer) => {
      await writer.aiProcess.update({
        where: { id: write.processId },
        data: {
          status: "completed",
          verdict: result.verdict,
          reasons: reasonsJson(result),
          evidence: evidenceJson(result),
          adult: result.adult,
          manipulationAttempt: result.manipulationAttempt,
          model: result.model,
          promptVersion: result.promptVersion,
          revisionId: write.input.revisionId,
          finishedAt: write.finishedAt,
          durationMs: write.durationMs
        },
        select: { id: true }
      })

      // Стоимость пишется только сюда: у записи проверки поля стоимости нет, поэтому показать
      // её отдельной строкой невозможно (журнал §27.4).
      await writer.aiCostAggregate.upsert({
        where: { bucketStart_bucketEnd_kind: { ...bucket, kind: "check" } },
        create: { ...bucket, kind: "check", totalCostMinor: BigInt(result.costMinor), processCount: 1 },
        update: { totalCostMinor: { increment: BigInt(result.costMinor) }, processCount: { increment: 1 } },
        select: { id: true }
      })

      if (result.verdict === "reject") {
        await writer.reviewMessage.create({
          data: {
            translationId: write.input.translationId,
            kind: "ai_decision",
            text: renderAiDecisionComment(result.reasons, write.locale)
          },
          select: { id: true }
        })
      }

      await writer.auditLog.create({
        data: {
          action: "ai.decision",
          entityType: AI_CHECK_OBJECT_TYPE,
          entityId: write.input.translationId,
          diff: {
            translationId: write.input.translationId,
            revisionId: write.input.revisionId,
            verdict: result.verdict,
            // В аудит идут коды категорий, а не текст для автора: текст живёт в записи проверки
            // и в комментарии истории решений (реестр #71).
            reasons: result.reasons.map((reason) => reason.category),
            promptVersion: result.promptVersion,
            ...(result.manipulationAttempt ? { manipulationAttempt: true } : {}),
            ...(result.adult ? { adult: true } : {})
          },
          ...(write.originRequestId ? { requestId: write.originRequestId } : {})
        },
        select: { id: true }
      })
    })
  }

  return {
    async runCheck(input) {
      const originRequestId = input.originRequestId ?? null
      const existing = await store.findProcessByJob(input.jobId)
      const process =
        existing ??
        (await store.createProcess({
          jobId: input.jobId,
          translationId: input.translationId,
          revisionId: input.revisionId
        }))

      // Повторный запуск задания после успеха второго вердикта не даёт: переиграть решение
      // проверки нельзя (журнал #14, `ai-processes.md` §5).
      if (process.status === "completed") return { aiProcessId: process.id, verdict: null }

      const startedAt = now()
      await store.updateProcess(process.id, {
        status: "started",
        startedAt,
        providerErrorClass: null,
        finishedAt: null,
        model: adapter.model,
        promptVersion: adapter.promptVersion
      })
      logger.log({
        level: "info",
        event: "ai.job.started",
        message: "AI check job started",
        jobId: input.jobId,
        ...(originRequestId ? { originRequestId } : {}),
        data: { kind: "check", provider: adapter.name, model: adapter.model }
      })

      let submission: AiCheckSubmission
      try {
        const source = await loadAiCheckSource(store, {
          translationId: input.translationId,
          revisionId: input.revisionId
        })
        submission = buildAiCheckSubmission(source)
      } catch (error: unknown) {
        // Подача не собирается — это не сбой провайдера: класс ошибки виден в записи и в логе,
        // а задание повторяет очередь до исчерпания попыток.
        await markFailed(process.id, input.jobId, originRequestId, startedAt, error)
        throw error
      }

      await store.updateProcess(process.id, { status: "running" })
      logger.log({
        level: "info",
        event: "ai.job.running",
        message: "AI check submission sent to the provider",
        jobId: input.jobId,
        ...(originRequestId ? { originRequestId } : {}),
        data: {
          kind: "check",
          provider: adapter.name,
          textLength: submission.blocks.length,
          images: submission.images.length
        }
      })

      let result: AiCheckResult
      try {
        result = await adapter.check(submission)
      } catch (error: unknown) {
        await markFailed(process.id, input.jobId, originRequestId, startedAt, error)
        // Наружу уходит недоступность провайдера: очередь повторит задание, а подача остаётся
        // в `ai_check` (`write-and-publish.md` §4–5).
        throw aiProviderUnavailableError(originRequestId ?? randomUUID())
      }

      const finishedAt = now()
      const durationMs = finishedAt.getTime() - startedAt.getTime()
      await writeResult({
        processId: process.id,
        input,
        locale: submission.locale,
        result,
        finishedAt,
        durationMs,
        originRequestId
      })

      logger.log({
        level: "info",
        event: "ai.job.done",
        message: "AI check job finished",
        jobId: input.jobId,
        ...(originRequestId ? { originRequestId } : {}),
        data: {
          kind: "check",
          provider: adapter.name,
          model: result.model,
          promptVersion: result.promptVersion,
          costMinor: result.costMinor,
          durationMs,
          verdict: result.verdict,
          reasons: result.reasons.map((reason) => reason.category)
        }
      })

      return { aiProcessId: process.id, verdict: result.verdict }
    }
  }
}
