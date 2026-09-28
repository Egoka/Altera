/**
 * Исправление описания `alt` администратором (T-067).
 *
 * Описание создаёт шаг AI один раз при обработке (журнал §29.11, §29.13): автор его не
 * редактирует, узел документа не переопределяет, а публичный вывод всегда берёт единое `alt`
 * медиафайла. Редкое исключение — исправление непосредственно у медиафайла, и только `admin`
 * (матрица #40). Действие аудируется общей оболочкой `admin.change` (реестр #75): `entity`,
 * `entityId` и поле со значениями до и после; нового кода события не добавляется (журнал §28.3).
 */

import type { Role } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import type { MediaAssetRecord, MediaAssetStore } from "./types"

/** Объект аудита и AI-процесса описания — сам медиафайл, а не материал (журнал §29.13). */
export const MEDIA_ASSET_ENTITY = "mediaAsset"

/** Действие матрицы #40: правка свойств медиафайла. */
export const MEDIA_META_ACTION = "media.update.meta"

/**
 * Предел длины описания `[ДОПУЩЕНИЕ]`: спецификация числа не задаёт. Как и у атрибуции
 * (`upload.ts`), ограничение держит поле описанием, а не хранилищем текста.
 */
export const MAX_ALT_LENGTH = 500

export interface AdminAltActor {
  id: string
  role: Role
}

export interface ApplyAdminAltInput {
  assetId: string
  alt: string
  actor: AdminAltActor
  requestId: string
}

export interface AdminAltDeps {
  store: Pick<MediaAssetStore, "findById" | "saveAltWithAudit">
}

/**
 * Проверка прав здесь не делается: её место — резолвер, как у остальных действий администратора.
 * Эта функция отвечает за значение, запись и её след в журнале.
 */
export async function applyAdminAlt(input: ApplyAdminAltInput, deps: AdminAltDeps): Promise<MediaAssetRecord> {
  const alt = input.alt.trim()
  if (!alt) {
    throw createApiError("VALIDATION_ERROR", { requestId: input.requestId, field: "alt", rule: "required" })
  }
  if (alt.length > MAX_ALT_LENGTH) {
    throw createApiError("VALIDATION_ERROR", { requestId: input.requestId, field: "alt", rule: "maxLength" })
  }

  const record = await deps.store.findById(input.assetId)
  if (!record || record.deletedAt) {
    throw createApiError("NOT_FOUND", { requestId: input.requestId, entity: MEDIA_ASSET_ENTITY })
  }

  // Прежнее значение совпало с новым — исправления не было, и записывать в журнал нечего.
  if (record.alt === alt) return record

  return deps.store.saveAltWithAudit({
    assetId: record.id,
    alt,
    audit: {
      action: "admin.change",
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: MEDIA_ASSET_ENTITY,
      entityId: record.id,
      diff: {
        entity: MEDIA_ASSET_ENTITY,
        entityId: record.id,
        fields: { alt: { from: record.alt, to: alt } }
      },
      requestId: input.requestId
    }
  })
}
