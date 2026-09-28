import { describe, expect, it, vi } from "vitest"
import {
  isMediaPurgeEnabled,
  MEDIA_ORPHAN_POLICY,
  orphanByteSize,
  orphanObjectKeys,
  runMediaPurge,
  type MediaOrphanRecord,
  type MediaOrphanStore
} from "../src/media/orphans"
import type { MediaVariantSet } from "../src/media/types"
import { masterKey, quarantineKey, variantKey } from "../src/storage/keys"
import { StorageUnavailableError } from "../src/storage/types"
import { createMemoryStorage } from "./helpers/media-memory"

/**
 * Чистка медиа-сирот (T-068) на двойниках портов: что удаляется, в каком порядке и что остаётся
 * следующему проходу. Само условие «нет активных связей» написано на SQL и проверяется на
 * настоящем PostgreSQL — `media-orphans-database.test.ts`.
 */

const NOW = new Date("2026-09-28T12:00:00.000Z")
const CREATED_AT = new Date("2026-09-01T00:00:00.000Z")
const assetId = (last: string): string => `00000000-0000-4000-8000-00000000000${last}`

function variantSet(id: string): MediaVariantSet {
  return {
    version: 1,
    placeholder: "data:image/webp;base64,AAAA",
    thumbnailWidth: 480,
    focal: null,
    items: [
      {
        format: "webp",
        width: 480,
        height: 320,
        key: variantKey({ assetId: id, createdAt: CREATED_AT, width: 480, format: "webp" }),
        byteSize: 300
      },
      {
        format: "avif",
        width: 480,
        height: 320,
        key: variantKey({ assetId: id, createdAt: CREATED_AT, width: 480, format: "avif" }),
        byteSize: 200
      }
    ]
  }
}

function orphan(id: string): MediaOrphanRecord {
  return {
    id,
    storageKey: masterKey({ assetId: id, createdAt: CREATED_AT, extension: "jpg" }),
    byteSize: 1_000,
    variants: variantSet(id)
  }
}

function memoryOrphanStore(records: readonly MediaOrphanRecord[]) {
  const kept = new Map(records.map((record) => [record.id, record]))
  const calls: { quietBefore: Date; limit: number }[] = []
  const store: MediaOrphanStore = {
    async findOrphans(input) {
      calls.push(input)
      return [...kept.values()]
    },
    async deleteAsset(id) {
      return kept.delete(id)
    }
  }
  return { store, kept, calls }
}

async function fillStorage(storage: ReturnType<typeof createMemoryStorage>, record: MediaOrphanRecord) {
  for (const key of orphanObjectKeys(record)) {
    await storage.put(key, Buffer.from("x"), { contentType: "image/jpeg" })
  }
}

describe("T-068 чистка медиа-сирот", () => {
  it("удаляет мастер, варианты и остаток карантина, затем запись, и считает число и объём", async () => {
    const record = orphan(assetId("1"))
    const storage = createMemoryStorage()
    await fillStorage(storage, record)
    const { store, kept } = memoryOrphanStore([record])

    const result = await runMediaPurge({ store, storage, now: () => NOW })

    expect(result).toEqual({ removed: 1, bytes: 1_500, failed: 0, failure: null })
    expect([...storage.objects.keys()]).toEqual([])
    expect(kept.size).toBe(0)
  })

  it("берёт окно тишины и размер порции из политики", async () => {
    const { store, calls } = memoryOrphanStore([])
    const storage = createMemoryStorage()

    await runMediaPurge({ store, storage, now: () => NOW })
    await runMediaPurge({
      store,
      storage,
      now: () => NOW,
      policy: { ...MEDIA_ORPHAN_POLICY, graceHours: 1, batchLimit: 5 }
    })

    expect(calls[0]).toEqual({
      quietBefore: new Date(NOW.getTime() - MEDIA_ORPHAN_POLICY.graceHours * 60 * 60_000),
      limit: MEDIA_ORPHAN_POLICY.batchLimit
    })
    expect(calls[1]).toEqual({ quietBefore: new Date("2026-09-28T11:00:00.000Z"), limit: 5 })
  })

  it("оставляет запись следующему проходу при сбое хранилища и возвращает первую ошибку", async () => {
    const failing = orphan(assetId("2"))
    const next = orphan(assetId("3"))
    const storage = createMemoryStorage()
    await fillStorage(storage, failing)
    await fillStorage(storage, next)
    const { store, kept } = memoryOrphanStore([failing, next])
    storage.failNext({ delete: 1 })

    const result = await runMediaPurge({ store, storage, now: () => NOW })

    expect(result.removed).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.failure).toBeInstanceOf(StorageUnavailableError)
    expect(kept.has(failing.id)).toBe(true)
    expect(kept.has(next.id)).toBe(false)
  })

  it("не считает удалённой запись, которую убрал параллельный проход", async () => {
    const record = orphan(assetId("4"))
    const storage = createMemoryStorage()
    await fillStorage(storage, record)
    const { store } = memoryOrphanStore([record])
    const deleteAsset = vi.spyOn(store, "deleteAsset").mockResolvedValue(false)

    const result = await runMediaPurge({ store, storage, now: () => NOW })

    expect(deleteAsset).toHaveBeenCalledWith(record.id)
    expect(result).toEqual({ removed: 0, bytes: 0, failed: 0, failure: null })
    // Объекты всё равно убраны: запись ушла, и держать её файлы больше незачем.
    expect([...storage.objects.keys()]).toEqual([])
  })

  it("повторный проход по уже вычищенной записи ничего не ломает", async () => {
    const record = orphan(assetId("5"))
    const storage = createMemoryStorage()
    await fillStorage(storage, record)
    const { store } = memoryOrphanStore([record])

    await runMediaPurge({ store, storage, now: () => NOW })
    const second = await runMediaPurge({ store, storage, now: () => NOW })

    expect(second).toEqual({ removed: 0, bytes: 0, failed: 0, failure: null })
  })

  it("собирает ключи записи вместе с остатком карантина и пропускает незнакомые", () => {
    const id = assetId("6")
    const record = {
      ...orphan(id),
      variants: { version: 1, items: [{ format: "webp", width: 480, height: 320, key: "../secret", byteSize: 7 }] }
    }

    const keys = orphanObjectKeys(record)

    expect(keys).toContain(masterKey({ assetId: id, createdAt: CREATED_AT, extension: "jpg" }))
    expect(keys).toContain(quarantineKey({ assetId: id }))
    expect(keys).not.toContain("../secret")
  })

  it("считает объём записи как мастер плюс собранные варианты", () => {
    expect(orphanByteSize(orphan(assetId("7")))).toBe(1_500)
    expect(orphanByteSize({ ...orphan(assetId("7")), variants: [] })).toBe(1_000)
  })

  it("расписание чистки по умолчанию выключено", () => {
    expect(isMediaPurgeEnabled({})).toBe(false)
    expect(isMediaPurgeEnabled({ MEDIA_PURGE_ENABLED: "1" })).toBe(false)
    expect(isMediaPurgeEnabled({ MEDIA_PURGE_ENABLED: "true" })).toBe(true)
  })
})
