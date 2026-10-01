/**
 * Хранилище записей AI-проверки: узкий интерфейс поверх Prisma.
 *
 * Сервис проверки не получает весь `PrismaClient`, потому что запись результата — это ровно
 * таблицы результата и условный переход версии. Границы видны по интерфейсу, а двойник в тестах
 * не повторяет клиент целиком.
 */

import { Prisma, type AiProcessStatus, type PrismaClient } from "../generated/prisma"
import type { AiCheckSubmissionStore } from "./submission"

/** Запись результата идёт одной транзакцией: вердикт без комментария автору недопустим. */
export interface AiCheckResultWriter {
  aiProcess: Pick<Prisma.TransactionClient["aiProcess"], "update">
  aiCostAggregate: Pick<Prisma.TransactionClient["aiCostAggregate"], "upsert">
  articleTranslation: Pick<Prisma.TransactionClient["articleTranslation"], "findUnique" | "updateMany" | "update">
  article: Pick<Prisma.TransactionClient["article"], "update">
  reviewMessage: Pick<Prisma.TransactionClient["reviewMessage"], "create">
  auditLog: Pick<Prisma.TransactionClient["auditLog"], "create">
  /// Содержимое ревизии подачи — читается на промотирование копии правки в публичную строку.
  articleRevision: Pick<Prisma.TransactionClient["articleRevision"], "findUnique">
  /// Копия правки опубликованной статьи (T-122): найти активную копию по ревизии подачи и
  /// применить решение AI к ней, не трогая публичную строку `articleTranslation`.
  publishedArticleEdit: Pick<
    Prisma.TransactionClient["publishedArticleEdit"],
    "findUnique" | "updateMany" | "deleteMany"
  >
}

export interface AiCheckProcessRecord {
  id: string
  status: AiProcessStatus
  verdict: string | null
}

export interface AiCheckStore extends AiCheckSubmissionStore {
  findProcessByJob(jobId: string): Promise<AiCheckProcessRecord | null>
  createProcess(input: {
    jobId: string
    translationId: string
    revisionId: string
    createdAt?: Date
  }): Promise<AiCheckProcessRecord>
  updateProcess(processId: string, data: Prisma.AiProcessUpdateInput): Promise<void>
  writeResult<T>(run: (writer: AiCheckResultWriter) => Promise<T>): Promise<T>
}

/** Объект проверки — версия статьи («статья с языком», `ai-processes.md` §3). */
export const AI_CHECK_OBJECT_TYPE = "ArticleTranslation"

export function createPrismaAiCheckStore(client: PrismaClient): AiCheckStore {
  return {
    articleTranslation: client.articleTranslation,
    articleRevision: client.articleRevision,
    mediaAsset: client.mediaAsset,

    async findProcessByJob(jobId) {
      return client.aiProcess.findFirst({
        where: { jobId, kind: "check" },
        select: { id: true, status: true, verdict: true }
      })
    },

    async createProcess(input) {
      return client.aiProcess.create({
        data: {
          jobId: input.jobId,
          kind: "check",
          status: "created",
          objectType: AI_CHECK_OBJECT_TYPE,
          objectId: input.translationId,
          revisionId: input.revisionId,
          ...(input.createdAt ? { createdAt: input.createdAt } : {})
        },
        select: { id: true, status: true, verdict: true }
      })
    },

    async updateProcess(processId, data) {
      await client.aiProcess.update({ where: { id: processId }, data, select: { id: true } })
    },

    writeResult(run) {
      return client.$transaction((transaction) => run(transaction))
    }
  }
}
