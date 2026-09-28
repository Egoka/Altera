/**
 * Шаг AI-описания изображения (T-067).
 *
 * Что пишется на одно описание: `alt` самого медиафайла, запись AI-процесса вида `alt`
 * (`40-admin/ai-processes.md` §3) и агрегат стоимости за период (§27.4). Аудита нет: описание
 * создаёт система при обработке, а не администратор; в логи идут `ai.job.*` (реестр #46,
 * `kind: alt`), нового кода события не добавляется (журнал §28.3).
 *
 * Описание создаётся **один раз** (журнал §29.13): запись с уже заполненным `alt` повторное
 * задание не переписывает, и условие «`alt` ещё пуст» проверяется самим обновлением, а не только
 * прочитанным состоянием.
 */

import { randomUUID } from "node:crypto"
import type { AppLogger } from "../../observability/logger"
import { parseStorageKey } from "../../storage/keys"
import type { ObjectStorage } from "../../storage/types"
import { aiCostBucket } from "../cost"
import { aiProviderUnavailableError } from "../types"
import { AI_ALT_OBJECT_TYPE } from "./queue"
import type { AiAltAssetRecord, AiAltStore } from "./store"
import type { AiAltAdapter, AiAltResult } from "./types"

export interface RunAiAltInput {
  jobId: string
  assetId: string
  /** `requestId` загрузки, если он дошёл до задания конвейера. */
  originRequestId?: string | null
}

export type AiAltOutcome =
  /** Описание создано этим проходом. */
  | { aiProcessId: string; result: "described"; alt: string }
  /** `alt` уже был заполнен либо вердикт задания уже вынесен: второй раз описание не создаётся. */
  | { aiProcessId: string; result: "already_described" }
  /** Описывать нечего: запись удалена или её уже нет. */
  | { aiProcessId: string; result: "skipped"; reason: "missing" | "deleted" }

export interface AiAltService {
  describe(input: RunAiAltInput): Promise<AiAltOutcome>
}

interface AiAltServiceOptions {
  store: AiAltStore
  storage: Pick<ObjectStorage, "get">
  adapter: AiAltAdapter
  logger: AppLogger
  now?: () => Date
}

const errorClassPattern = /^[A-Z][A-Za-z0-9_]{1,63}$/

/** Класс ошибки без сообщения: сообщение провайдера может содержать текст его ответа. */
function errorClassOf(error: unknown): string {
  const name = error instanceof Error ? error.name : ""
  if (errorClassPattern.test(name)) return name
  return error instanceof Error ? error.constructor.name : "UnknownError"
}

/**
 * Описывается только готовый мастер-файл: у записи до готовности `storageKey` указывает на
 * карантин, и провайдеру ушли бы неочищенные байты загрузки — с EXIF и геолокацией
 * (`upload-pipeline.md` п. 5). Такое задание не отбрасывается, а повторяется очередью.
 */
class MediaNotProcessedError extends Error {
  override name = "MediaNotProcessedError"
}

/** Мастера нет на месте: без байтов описывать нечего, повтор ведёт очередь. */
class MediaMasterMissingError extends Error {
  override name = "MediaMasterMissingError"
}

function isMasterReady(asset: AiAltAssetRecord): boolean {
  return asset.processingStatus === "ready" && parseStorageKey(asset.storageKey)?.kind === "master"
}

export function createAiAltService(options: AiAltServiceOptions): AiAltService {
  const { store, storage, adapter, logger } = options
  const now = options.now ?? (() => new Date())

  async function markFailed(
    processId: string,
    input: RunAiAltInput,
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
      message: "AI alt job failed",
      jobId: input.jobId,
      ...(originRequestId ? { originRequestId } : {}),
      data: { kind: "alt", assetId: input.assetId, provider: adapter.name, errorClass }
    })
  }

  /** Описание и запись процесса — одной транзакцией; стоимость идёт только в агрегат (§27.4). */
  async function writeResult(write: {
    processId: string
    assetId: string
    result: AiAltResult
    finishedAt: Date
    durationMs: number
  }): Promise<boolean> {
    const bucket = aiCostBucket(write.finishedAt)

    return store.writeResult(async (writer) => {
      // Условие «`alt` ещё пуст» стоит в самом обновлении: два задания по одному файлу не
      // перепишут друг друга, и описание остаётся созданным один раз (журнал §29.13).
      const { count } = await writer.mediaAsset.updateMany({
        where: { id: write.assetId, alt: null },
        data: { alt: write.result.alt }
      })

      await writer.aiProcess.update({
        where: { id: write.processId },
        data: {
          status: "completed",
          model: write.result.model,
          promptVersion: write.result.promptVersion,
          finishedAt: write.finishedAt,
          durationMs: write.durationMs
        },
        select: { id: true }
      })

      await writer.aiCostAggregate.upsert({
        where: { bucketStart_bucketEnd_kind: { ...bucket, kind: "alt" } },
        create: { ...bucket, kind: "alt", totalCostMinor: BigInt(write.result.costMinor), processCount: 1 },
        update: { totalCostMinor: { increment: BigInt(write.result.costMinor) }, processCount: { increment: 1 } },
        select: { id: true }
      })

      return count > 0
    })
  }

  return {
    async describe(input) {
      const originRequestId = input.originRequestId ?? null
      const existing = await store.findProcessByJob(input.jobId)
      const process = existing ?? (await store.createProcess({ jobId: input.jobId, assetId: input.assetId }))

      // Повторный запуск задания после успеха второго описания не даёт: шаг одноразовый.
      if (process.status === "completed") return { aiProcessId: process.id, result: "already_described" }

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
        message: "AI alt job started",
        jobId: input.jobId,
        ...(originRequestId ? { originRequestId } : {}),
        data: { kind: "alt", assetId: input.assetId, provider: adapter.name, model: adapter.model }
      })

      const asset = await store.findAsset(input.assetId)
      // Записи нет или она удалена: повтор её не вернёт, поэтому задание завершается, а не падает.
      if (!asset || asset.deletedAt) {
        const finishedAt = now()
        await store.updateProcess(process.id, {
          status: "completed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime()
        })
        return { aiProcessId: process.id, result: "skipped", reason: asset ? "deleted" : "missing" }
      }

      // `alt` уже есть — описание создано раньше: провайдер не вызывается и стоимость не растёт.
      if (asset.alt !== null) {
        const finishedAt = now()
        await store.updateProcess(process.id, {
          status: "completed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime()
        })
        return { aiProcessId: process.id, result: "already_described" }
      }

      let body: Buffer
      try {
        if (!isMasterReady(asset)) throw new MediaNotProcessedError("Media asset is not processed yet")
        const master = await storage.get(asset.storageKey)
        if (!master) throw new MediaMasterMissingError("Master file is gone")
        body = master.body
      } catch (error: unknown) {
        await markFailed(process.id, input, originRequestId, startedAt, error)
        throw error
      }

      await store.updateProcess(process.id, { status: "running" })
      logger.log({
        level: "info",
        event: "ai.job.running",
        message: "AI alt image sent to the provider",
        jobId: input.jobId,
        ...(originRequestId ? { originRequestId } : {}),
        data: { kind: "alt", assetId: input.assetId, provider: adapter.name, byteSize: body.length }
      })

      let result: AiAltResult
      try {
        result = await adapter.describe({
          assetId: asset.id,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          body
        })
      } catch (error: unknown) {
        // Поведение при ошибке генерации — отдельный проход (`upload-pipeline.md` п. 6а):
        // пока повтор ведёт очередь, а выдуманного описания вместо ответа модели не появляется.
        await markFailed(process.id, input, originRequestId, startedAt, error)
        throw aiProviderUnavailableError(originRequestId ?? randomUUID())
      }

      const finishedAt = now()
      const durationMs = finishedAt.getTime() - startedAt.getTime()
      const saved = await writeResult({
        processId: process.id,
        assetId: asset.id,
        result,
        finishedAt,
        durationMs
      })

      logger.log({
        level: "info",
        event: "ai.job.done",
        message: "AI alt job finished",
        jobId: input.jobId,
        ...(originRequestId ? { originRequestId } : {}),
        data: {
          kind: "alt",
          assetId: asset.id,
          objectType: AI_ALT_OBJECT_TYPE,
          provider: adapter.name,
          model: result.model,
          promptVersion: result.promptVersion,
          costMinor: result.costMinor,
          durationMs,
          saved
        }
      })

      // Описание не записалось: параллельный проход успел раньше, и переписывать его нельзя.
      return saved
        ? { aiProcessId: process.id, result: "described", alt: result.alt }
        : { aiProcessId: process.id, result: "already_described" }
    }
  }
}
