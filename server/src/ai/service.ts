/**
 * Запись результата AI-проверки (T-048).
 *
 * Что пишется на один вердикт: запись AI-процесса со статусом и причинами
 * (`docs/spec/40-admin/ai-processes.md` §3), агрегат стоимости за период (§27.4 — у отдельной
 * записи стоимости нет), комментарий автору в историю решений при отказе
 * (`30-account/author/review-history.md` §4) и аудит `ai.decision` (реестр #71).
 *
 * Вердикт и условный переход ожидающей ревизии записываются одной транзакцией. Поздний результат
 * отозванной или уже заменённой ревизии сохраняется для аудита, но публичный статус не меняет.
 */

import { randomUUID } from "node:crypto"
import type { Prisma, Locale } from "../generated/prisma"
import type { AppLogger } from "../observability/logger"
import { aiCostBucket } from "./cost"
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

export { aiCostBucket } from "./cost"

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
  onPublished?: (translationId: string) => Promise<void>
  /**
   * Вызывается ровно один раз — когда вердикт действительно применился к ожидающей ревизии
   * (журнал #14): не на повторной обработке уже завершённого задания. Основа уведомления автору
   * о решении (T-051).
   */
  onDecision?: (input: {
    translationId: string
    verdict: AiCheckVerdict
    originRequestId: string | null
  }) => Promise<void>
  now?: () => Date
}

const errorClassPattern = /^[A-Z][A-Za-z0-9_]{1,63}$/

/** Класс ошибки без сообщения: сообщение провайдера может содержать текст подачи. */
function errorClassOf(error: unknown): string {
  const name = error instanceof Error ? error.name : ""
  if (errorClassPattern.test(name)) return name
  return error instanceof Error ? error.constructor.name : "UnknownError"
}

function reasonsJson(result: AiCheckResult): Prisma.InputJsonValue {
  return result.reasons.map((reason) => ({ category: reason.category, text: reason.text }))
}

function evidenceJson(result: AiCheckResult): Prisma.InputJsonValue {
  return result.evidence.map((item) => ({ category: item.category, fragment: item.fragment }))
}

export function createAiCheckService(options: AiCheckServiceOptions): AiCheckService {
  const { store, adapter, logger, onPublished, onDecision } = options
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
  }): Promise<{ transitioned: boolean; verdict: AiCheckVerdict; publishedEditPromoted: boolean }> {
    const { result } = write
    const bucket = aiCostBucket(write.finishedAt)

    return store.writeResult(async (writer) => {
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

      const translation = await writer.articleTranslation.findUnique({
        where: { id: write.input.translationId },
        select: {
          id: true,
          articleId: true,
          locale: true,
          status: true,
          updatedAt: true,
          revisions: { select: { id: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
          article: { select: { sourceLocale: true, firstPublishedAt: true } }
        }
      })
      const applies = translation?.status === "ai_check" && translation.revisions[0]?.id === write.input.revisionId
      let transitioned = false
      if (applies) {
        const publishedAt = result.verdict === "publish" ? write.finishedAt : undefined
        const changed = await writer.articleTranslation.updateMany({
          where: {
            id: write.input.translationId,
            status: "ai_check",
            updatedAt: translation.updatedAt
          },
          data: {
            status: result.verdict === "publish" ? "published" : "review",
            ...(publishedAt
              ? { publishedAt, reeditUntil: new Date(publishedAt.getTime() + 60 * 60 * 1000), rejected: false }
              : {})
          }
        })
        transitioned = changed.count === 1
        if (transitioned && translation.locale === translation.article.sourceLocale) {
          await writer.article.update({
            where: { id: translation.articleId },
            data: {
              status: result.verdict === "publish" ? "published" : "review",
              ...(publishedAt
                ? {
                    publishedAt,
                    firstPublishedAt: translation.article.firstPublishedAt ?? publishedAt
                  }
                : {})
            },
            select: { id: true }
          })
        }
      }

      /**
       * Копия правки опубликованной статьи (T-122, журнал §41 п. 2–3). Публичная строка остаётся
       * `published` весь срок проверки: `applies` выше это условие не находит, поэтому решение
       * копии ищется и применяется отдельно, по активной `PublishedArticleEdit` этой статьи.
       */
      const edit =
        !applies && translation?.status === "published"
          ? await writer.publishedArticleEdit.findUnique({
              where: { articleId: translation.articleId },
              select: { id: true, translationId: true, latestRevisionId: true, status: true }
            })
          : null
      const editApplies =
        edit?.translationId === write.input.translationId &&
        edit.latestRevisionId === write.input.revisionId &&
        edit.status === "ai_check"

      let publishedEditPromoted = false
      if (editApplies && edit) {
        if (result.verdict === "publish") {
          const revision = await writer.articleRevision.findUnique({
            where: { id: write.input.revisionId },
            select: { title: true, dek: true, excerpt: true, body: true }
          })
          if (revision) {
            const changed = await writer.publishedArticleEdit.deleteMany({
              where: { id: edit.id, status: "ai_check", latestRevisionId: write.input.revisionId }
            })
            if (changed.count === 1) {
              await writer.articleTranslation.update({
                where: { id: write.input.translationId },
                data: {
                  title: revision.title,
                  dek: revision.dek,
                  excerpt: revision.excerpt,
                  body: revision.body as unknown as Prisma.InputJsonValue
                }
              })
              publishedEditPromoted = true
            }
          }
        } else {
          await writer.publishedArticleEdit.updateMany({
            where: { id: edit.id, status: "ai_check", latestRevisionId: write.input.revisionId },
            data: { status: "rework" }
          })
        }
      }

      if ((transitioned || editApplies) && result.verdict === "reject") {
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
      return { transitioned, verdict: result.verdict, publishedEditPromoted }
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
      if (process.status === "completed") {
        if (process.verdict === "publish") await onPublished?.(input.translationId)
        return { aiProcessId: process.id, verdict: null }
      }

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
      const outcome = await writeResult({
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

      if (outcome.transitioned && outcome.verdict === "publish") {
        if (originRequestId) {
          logger.metric?.({
            event: "translation.published",
            requestId: originRequestId,
            data: { translationId: input.translationId }
          })
        }
        await onPublished?.(input.translationId)
      }
      // Промотирование копии правки меняет публичное содержимое версии, хотя её статус не
      // переходил (он весь срок проверки остаётся `published`) — кеш инвалидируется отдельно
      // от метрики и письма первой публикации, которые этому случаю не подходят.
      if (outcome.publishedEditPromoted) {
        await onPublished?.(input.translationId)
      }
      if (outcome.transitioned) {
        await onDecision?.({ translationId: input.translationId, verdict: outcome.verdict, originRequestId })
      }

      return { aiProcessId: process.id, verdict: result.verdict }
    }
  }
}
