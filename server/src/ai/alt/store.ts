/**
 * Хранилище шага AI-описания: узкий интерфейс поверх Prisma.
 *
 * Сервис описания не получает весь `PrismaClient`, потому что запись результата — это ровно
 * три таблицы: AI-процесс, агрегат стоимости и сам медиафайл. Аудита здесь нет: описание
 * создаёт система при обработке, а не администратор (журнал §29.13, реестр #46).
 */

import { Prisma, type AiProcessStatus, type MediaProcessingStatus, type PrismaClient } from "../../generated/prisma"
import { AI_ALT_OBJECT_TYPE } from "./queue"

/** Поля медиафайла, которых достаточно шагу описания: байты берутся из хранилища по ключу. */
export interface AiAltAssetRecord {
  id: string
  alt: string | null
  storageKey: string
  mimeType: string
  width: number | null
  height: number | null
  processingStatus: MediaProcessingStatus
  deletedAt: Date | null
}

export interface AiAltProcessRecord {
  id: string
  status: AiProcessStatus
}

/** Запись результата идёт одной транзакцией: описание без записи AI-процесса недопустимо. */
export interface AiAltResultWriter {
  aiProcess: Pick<Prisma.TransactionClient["aiProcess"], "update">
  aiCostAggregate: Pick<Prisma.TransactionClient["aiCostAggregate"], "upsert">
  mediaAsset: Pick<Prisma.TransactionClient["mediaAsset"], "updateMany">
}

export interface AiAltStore {
  findAsset(assetId: string): Promise<AiAltAssetRecord | null>
  findProcessByJob(jobId: string): Promise<AiAltProcessRecord | null>
  createProcess(input: { jobId: string; assetId: string }): Promise<AiAltProcessRecord>
  updateProcess(processId: string, data: Prisma.AiProcessUpdateInput): Promise<void>
  writeResult<T>(run: (writer: AiAltResultWriter) => Promise<T>): Promise<T>
}

const assetSelect = {
  id: true,
  alt: true,
  storageKey: true,
  mimeType: true,
  width: true,
  height: true,
  processingStatus: true,
  deletedAt: true
} as const

export function createPrismaAiAltStore(client: PrismaClient): AiAltStore {
  return {
    async findAsset(assetId) {
      return client.mediaAsset.findUnique({ where: { id: assetId }, select: assetSelect })
    },

    async findProcessByJob(jobId) {
      return client.aiProcess.findFirst({ where: { jobId, kind: "alt" }, select: { id: true, status: true } })
    },

    async createProcess(input) {
      return client.aiProcess.create({
        data: {
          jobId: input.jobId,
          kind: "alt",
          status: "created",
          objectType: AI_ALT_OBJECT_TYPE,
          objectId: input.assetId
        },
        select: { id: true, status: true }
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
