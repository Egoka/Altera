import { subHours } from "date-fns"
import { isStorageKey, quarantineKey } from "../storage/keys"
import type { ObjectStorage } from "../storage/types"
import { readVariantSet } from "./variants"

// Сироты и их чистка (`retention-and-orphans.md` §2 п. 5–7, журнал §29.8). Сирота — запись
// `MediaAsset` без активных связей: ни обложка материала, ни текущий или предыдущий аватар
// (§29.5), ни узел документа языковой версии, ни ссылка из хранимой ревизии (п. 7). Статус
// материала на это не влияет: архив закрывает публичный доступ к файлу, но связь остаётся, и
// медиа архивированной статьи сиротой не становится (журнал #11, #28).

/** Вид задания очереди (T-047): физическое удаление медиа без активных связей. */
export const MEDIA_PURGE_JOB_KIND = "media.purge"

/**
 * Числа обслуживания. Спецификация их не задаёт: интервал очистки медиа-сирот — предложение
 * архитектора на утверждение владельцу (журнал §33 п. 3), поэтому значения ниже остаются
 * `[ДОПУЩЕНИЕ]`, а само расписание до утверждения закрыто признаком `MEDIA_PURGE_ENABLED`
 * (`isMediaPurgeEnabled`) — физическое удаление необратимо.
 */
export interface MediaOrphanPolicy {
  /**
   * Окно тишины: запись моложе окна кандидатом не становится. Только что созданная запись связей
   * ещё не имеет — файл принят в карантин, а узел документа появится после вставки в редакторе;
   * то же окно даёт запас обратимости после отвязки (§2 п. 1).
   * `[ДОПУЩЕНИЕ: 24 часа]`
   */
  readonly graceHours: number
  /** Сколько записей чистит один прогон: остальные берёт следующий. `[ДОПУЩЕНИЕ: 200]` */
  readonly batchLimit: number
  /** Период постановки задания. `[ДОПУЩЕНИЕ: сутки]` */
  readonly runIntervalMs: number
}

export const MEDIA_ORPHAN_POLICY: MediaOrphanPolicy = {
  graceHours: 24,
  batchLimit: 200,
  runIntervalMs: 24 * 60 * 60_000
}

/** Поля кандидата, которых достаточно, чтобы удалить его объекты и посчитать объём. */
export interface MediaOrphanRecord {
  id: string
  storageKey: string
  byteSize: number
  variants: unknown
}

export interface MediaOrphanStore {
  /** Записи без активных связей, которые молчат дольше окна; порядок — от самых старых. */
  findOrphans(input: { quietBefore: Date; limit: number }): Promise<readonly MediaOrphanRecord[]>
  /** `false`, если записи уже нет: параллельный прогон или «удалить навсегда» успели раньше. */
  deleteAsset(id: string): Promise<boolean>
}

export interface MediaPurgeDeps {
  store: MediaOrphanStore
  storage: ObjectStorage
  policy?: MediaOrphanPolicy
  now?: () => Date
}

export interface MediaPurgeResult {
  /** Число удалённых записей — первая половина отчёта §2 п. 6. */
  removed: number
  /** Объём удалённых объектов в байтах — вторая половина отчёта. */
  bytes: number
  /** Кандидаты, оставшиеся до следующего прохода из-за сбоя. */
  failed: number
  /** Первая ошибка прохода: её класс должен дойти до `job.failed`, а не потеряться в счётчике. */
  failure: unknown
}

/**
 * Объекты записи: мастер (или, если обработка не дошла до него, сам карантинный ключ), варианты
 * набора и возможный остаток карантина после прерванной обработки. Незнакомый ключ пропускается:
 * хранилище такой ключ всё равно не примет, а прогон из-за него не должен падать.
 */
export function orphanObjectKeys(record: MediaOrphanRecord): readonly string[] {
  const keys = new Set<string>()
  if (isStorageKey(record.storageKey)) keys.add(record.storageKey)
  for (const item of readVariantSet(record.variants).items) {
    if (isStorageKey(item.key)) keys.add(item.key)
  }
  keys.add(quarantineKey({ assetId: record.id }))
  return [...keys]
}

/** Объём записи: мастер плюс собранные варианты. Заполнитель — строка в записи, не объект. */
export function orphanByteSize(record: MediaOrphanRecord): number {
  const variants = readVariantSet(record.variants).items.reduce((total, item) => total + item.byteSize, 0)
  return record.byteSize + variants
}

/**
 * Проход чистки: объекты хранилища удаляются раньше записи — обратный порядок потерял бы ключи и
 * оставил объекты в бакете навсегда. Повторный проход по той же записи безопасен: удаление
 * отсутствующего ключа ошибкой не считается, а удалённая запись в выборку уже не попадает.
 *
 * Сбой на одной записи не отменяет остальные: её объекты остаются, запись — тоже, и следующий
 * проход возьмёт её снова. Первая ошибка возвращается вызывающему — обработчик задания бросает
 * её наружу, чтобы очередь T-047 повторила проход, а класс ошибки дошёл до `job.failed`.
 *
 * Автор об очистке не уведомляется (журнал §29.8): почты у прохода нет по устройству — порт
 * письма ему не передаётся.
 */
export async function runMediaPurge(deps: MediaPurgeDeps): Promise<MediaPurgeResult> {
  const policy = deps.policy ?? MEDIA_ORPHAN_POLICY
  const now = deps.now?.() ?? new Date()
  const orphans = await deps.store.findOrphans({
    quietBefore: subHours(now, policy.graceHours),
    limit: policy.batchLimit
  })

  const result: MediaPurgeResult = { removed: 0, bytes: 0, failed: 0, failure: null }
  for (const record of orphans) {
    try {
      for (const key of orphanObjectKeys(record)) {
        await deps.storage.delete(key)
      }
      if (!(await deps.store.deleteAsset(record.id))) continue
      result.removed += 1
      result.bytes += orphanByteSize(record)
    } catch (error: unknown) {
      result.failed += 1
      result.failure ??= error
    }
  }
  return result
}

/**
 * Признак включённого расписания чистки: по умолчанию выключено. Числа окна и интервала ещё не
 * утверждены владельцем (журнал §33 п. 3), а удаление файлов необратимо — тем же порядком закрыта
 * и загрузка (`MEDIA_UPLOAD_ENABLED`).
 */
export function isMediaPurgeEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.MEDIA_PURGE_ENABLED === "true"
}
