import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, it } from "vitest"
import { detectImageFormat } from "../src/media/formats"
import { MAX_IMAGE_PIXELS, MAX_UPLOAD_BYTES } from "../src/media/limits"
import { runMediaProcessing } from "../src/media/pipeline"
import { acceptMediaUpload, isMediaLicense, type MediaUploadDeps } from "../src/media/upload"
import { decidePublicAccess } from "../src/storage/access"
import { masterKey, parseStorageKey, quarantineKey } from "../src/storage/keys"
import {
  createFakeImageProcessor as createFakeProcessor,
  createMemoryMediaQueue,
  createMemoryMediaStore,
  createMemoryStorage,
  uploadSourceOf,
  type MemoryMediaStore,
  type MemoryStorage
} from "./helpers/media-memory"

// Конвейер загрузки T-063: приём в карантин, проверки, мастер, статусы и повтор после частичной
// ошибки. Обработчик изображений здесь — двойник; удаление EXIF проверяет настоящий `sharp`
// в `media-master-exif.test.ts`.

const OWNER = "user-author"
const REQUEST = "request-1"

/** JPEG опознаётся по сигнатуре содержимого, поэтому фикстуре достаточно верных первых байтов. */
const jpegBytes = (marker: string): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(marker)])
const pngBytes = (): Buffer =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-body")])
const gifBytes = (): Buffer => Buffer.concat([Buffer.from("GIF89a"), Buffer.from("gif-body")])

describe("T-063 конвейер загрузки медиа", () => {
  let store: MemoryMediaStore
  let storage: MemoryStorage
  let jobs: ReturnType<typeof createMemoryMediaQueue>
  let deps: MediaUploadDeps
  let assetId: string

  beforeEach(() => {
    store = createMemoryMediaStore()
    storage = createMemoryStorage()
    jobs = createMemoryMediaQueue()
    assetId = randomUUID()
    deps = { store, storage, queue: jobs.queue, newAssetId: () => assetId }
  })

  const accept = (overrides: Partial<Parameters<typeof acceptMediaUpload>[0]> = {}) =>
    acceptMediaUpload(
      {
        ownerId: OWNER,
        file: uploadSourceOf(jpegBytes("photo")),
        license: "own",
        attribution: "Иван Петров",
        requestId: REQUEST,
        ...overrides
      },
      deps
    )

  describe("критерий 2: лицензия и атрибуция обязательны", () => {
    it("отклоняет загрузку без атрибуции с VALIDATION_ERROR", async () => {
      await expect(accept({ attribution: "   " })).rejects.toMatchObject({
        extensions: { code: "VALIDATION_ERROR", field: "attribution", rule: "required" }
      })
      expect(store.records.size).toBe(0)
      expect(storage.objects.size).toBe(0)
    })

    it("отклоняет лицензию вне справочника с VALIDATION_ERROR", async () => {
      await expect(accept({ license: "whatever" })).rejects.toMatchObject({
        extensions: { code: "VALIDATION_ERROR", field: "license", rule: "enum" }
      })
      expect(store.records.size).toBe(0)
    })

    it("принимает каждое значение справочника лицензий", () => {
      expect(["own", "cc_by", "cc_by_sa", "cc_by_nc", "cc0", "public_domain", "permission"].every(isMediaLicense)).toBe(
        true
      )
      expect(isMediaLicense("cc_by_nd")).toBe(false)
    })

    it("проверяет лицензию до чтения байтов файла", async () => {
      let read = false
      const file = {
        size: 10,
        bytes: async () => {
          read = true
          return jpegBytes("photo")
        }
      }
      await expect(accept({ file, attribution: "" })).rejects.toMatchObject({
        extensions: { code: "VALIDATION_ERROR" }
      })
      expect(read).toBe(false)
    })
  })

  describe("приём в карантин", () => {
    it("кладёт байты в карантинный префикс и ставит задание обработки", async () => {
      const record = await accept()

      expect(record.processingStatus).toBe("queued")
      expect(record.storageKey).toBe(quarantineKey({ assetId }))
      expect(parseStorageKey(record.storageKey)).toEqual({ kind: "quarantine", assetId })
      expect([...storage.objects.keys()]).toEqual([quarantineKey({ assetId })])
      expect(jobs.jobs).toEqual([{ assetId, requestId: REQUEST }])
      expect(store.statusHistory(assetId)).toEqual(["uploading", "queued"])
    })

    it("карантин публичным не бывает", () => {
      expect(decidePublicAccess("quarantine", null)).toBe("closed")
      expect(
        decidePublicAccess("quarantine", {
          deletedAt: null,
          processingStatus: "ready",
          coverOf: [{ status: "published" }],
          avatarOf: []
        })
      ).toBe("closed")
    })

    it("определяет тип по содержимому, а не по имени и заголовку", async () => {
      const record = await accept({ file: uploadSourceOf(pngBytes()) })
      expect(record.mimeType).toBe("image/png")
    })

    it("отклоняет формат, который этот проход не принимает", async () => {
      await expect(accept({ file: uploadSourceOf(gifBytes()) })).rejects.toMatchObject({
        extensions: { code: "VALIDATION_ERROR", field: "file", rule: "unsupportedType" }
      })
      expect(detectImageFormat(gifBytes())).toBeNull()
    })

    it("отклоняет пустой файл и файл больше порога", async () => {
      await expect(accept({ file: uploadSourceOf(Buffer.alloc(0)) })).rejects.toMatchObject({
        extensions: { code: "VALIDATION_ERROR", field: "file", rule: "required" }
      })
      await expect(
        accept({ file: { size: MAX_UPLOAD_BYTES + 1, bytes: async () => jpegBytes("x") } })
      ).rejects.toMatchObject({ extensions: { code: "VALIDATION_ERROR", field: "file", rule: "maxSize" } })
    })

    it("не верит объявленному размеру: порог проверяется по фактической длине", async () => {
      const bytes = Buffer.concat([jpegBytes("big"), Buffer.alloc(MAX_UPLOAD_BYTES)])
      await expect(accept({ file: { size: 10, bytes: async () => bytes } })).rejects.toMatchObject({
        extensions: { code: "VALIDATION_ERROR", field: "file", rule: "maxSize" }
      })
    })

    it("повторная загрузка того же файла возвращает существующую запись", async () => {
      const first = await accept()
      const second = await accept()

      expect(second.id).toBe(first.id)
      expect(store.records.size).toBe(1)
      expect(storage.objects.size).toBe(1)
      expect(jobs.jobs).toHaveLength(1)
    })

    it("недоступное хранилище даёт PROVIDER_UNAVAILABLE и запись в состоянии ошибки", async () => {
      storage.failNext({ put: 1 })

      await expect(accept()).rejects.toMatchObject({
        extensions: { code: "PROVIDER_UNAVAILABLE", provider: "storage" }
      })
      expect(store.records.get(assetId)?.processingStatus).toBe("failed")
      expect(storage.objects.size).toBe(0)
    })
  })

  describe("критерий 3: статусы обработки", () => {
    it("проходит uploading → queued → processing → ready и создаёт мастер", async () => {
      const { processor, calls } = createFakeProcessor()
      await accept()

      const outcome = await runMediaProcessing(assetId, { store, storage, processor })

      expect(outcome).toEqual({ result: "ready", masterCreated: true })
      expect(store.statusHistory(assetId)).toEqual(["uploading", "queued", "processing", "ready"])
      const record = store.records.get(assetId)!
      const expectedKey = masterKey({ assetId, createdAt: record.createdAt, extension: "jpg" })
      expect(record.storageKey).toBe(expectedKey)
      expect(record.width).toBe(1200)
      expect(record.height).toBe(800)
      expect(record.byteSize).toBe(Buffer.from("master-bytes").length)
      // Карантин снят: постоянным оригиналом остаётся мастер (§29.2), рядом — варианты (T-064).
      expect(storage.objects.has(quarantineKey({ assetId }))).toBe(false)
      expect(storage.objects.has(expectedKey)).toBe(true)
      expect(calls.createMaster).toBe(1)
    })

    it("повторное задание по готовой записи ничего не меняет", async () => {
      const { processor, calls } = createFakeProcessor()
      await accept()
      await runMediaProcessing(assetId, { store, storage, processor })

      const outcome = await runMediaProcessing(assetId, { store, storage, processor })

      expect(outcome).toEqual({ result: "already_ready" })
      expect(calls.createMaster).toBe(1)
      expect(store.statusHistory(assetId)).toEqual(["uploading", "queued", "processing", "ready"])
    })

    it("частичная ошибка после мастера даёт failed, а повтор доводит до ready без потери мастера", async () => {
      const { processor, calls } = createFakeProcessor()
      await accept()
      // Мастер создан, а снятие карантина отказало: это и есть частичная ошибка (§29.12).
      storage.failNext({ delete: 1 })

      await expect(runMediaProcessing(assetId, { store, storage, processor })).rejects.toThrow(
        /Memory storage delete failed/
      )

      const failed = store.records.get(assetId)!
      const expectedKey = masterKey({ assetId, createdAt: failed.createdAt, extension: "jpg" })
      expect(failed.processingStatus).toBe("failed")
      expect(failed.storageKey).toBe(expectedKey)
      expect(storage.objects.has(expectedKey)).toBe(true)
      const variantsAfterFirstRun = calls.createVariant

      const retry = await runMediaProcessing(assetId, { store, storage, processor })

      expect(retry).toEqual({ result: "ready", masterCreated: false })
      // Ни мастер, ни варианты не пересозданы: повтор доделал только недостающий шаг.
      expect(calls.createMaster).toBe(1)
      expect(calls.createVariant).toBe(variantsAfterFirstRun)
      expect(store.records.get(assetId)?.storageKey).toBe(expectedKey)
      expect(storage.objects.has(quarantineKey({ assetId }))).toBe(false)
      expect(store.statusHistory(assetId)).toEqual([
        "uploading",
        "queued",
        "processing",
        "failed",
        "processing",
        "ready"
      ])
    })

    it("повторная загрузка отказавшей записи возвращает её в очередь", async () => {
      const { processor } = createFakeProcessor()
      await accept()
      storage.failNext({ delete: 1 })
      await expect(runMediaProcessing(assetId, { store, storage, processor })).rejects.toThrow()

      const requeued = await accept()

      expect(requeued.id).toBe(assetId)
      expect(requeued.processingStatus).toBe("queued")
      expect(jobs.jobs).toEqual([
        { assetId, requestId: REQUEST },
        { assetId, requestId: REQUEST }
      ])
    })

    it("не принятое содержимое переводит запись в failed и задание не повторяет", async () => {
      const { processor } = createFakeProcessor({ width: 20_000, height: 20_000 })
      await accept()

      const outcome = await runMediaProcessing(assetId, { store, storage, processor })

      expect(20_000 * 20_000).toBeGreaterThan(MAX_IMAGE_PIXELS)
      expect(outcome).toEqual({ result: "rejected", rule: "file.pixels" })
      expect(store.records.get(assetId)?.processingStatus).toBe("failed")
      // Мастера нет, байты загрузки остались в карантине — их разбирает чистка сирот (T-068).
      expect([...storage.objects.keys()]).toEqual([quarantineKey({ assetId })])
    })

    it("анимация этим проходом не принимается", async () => {
      const { processor } = createFakeProcessor({ frames: 12 })
      await accept()

      await expect(runMediaProcessing(assetId, { store, storage, processor })).resolves.toEqual({
        result: "rejected",
        rule: "file.animation"
      })
    })

    it("повреждённое содержимое отказывает целостностью и не даёт мастера", async () => {
      const { processor } = createFakeProcessor({ failInspect: true })
      await accept()

      await expect(runMediaProcessing(assetId, { store, storage, processor })).rejects.toThrow(/decode failed/)
      expect(store.records.get(assetId)?.processingStatus).toBe("failed")
      expect(parseStorageKey(store.records.get(assetId)!.storageKey)?.kind).toBe("quarantine")
    })

    it("потерянный карантин без мастера отказывает и не создаёт пустую запись", async () => {
      const { processor } = createFakeProcessor()
      await accept()
      storage.objects.clear()

      const outcome = await runMediaProcessing(assetId, { store, storage, processor })

      expect(outcome).toEqual({ result: "rejected", rule: "file.missing" })
      expect(store.records.get(assetId)?.processingStatus).toBe("failed")
    })

    it("удалённая и несуществующая запись задание пропускает", async () => {
      const { processor } = createFakeProcessor()
      await accept()
      store.records.set(assetId, { ...store.records.get(assetId)!, deletedAt: new Date() })

      await expect(runMediaProcessing(assetId, { store, storage, processor })).resolves.toEqual({
        result: "skipped",
        reason: "deleted"
      })
      await expect(runMediaProcessing(randomUUID(), { store, storage, processor })).resolves.toEqual({
        result: "skipped",
        reason: "missing"
      })
    })

    it("публичный доступ появляется только у варианта готового медиа", async () => {
      const { processor } = createFakeProcessor()
      await accept()
      const usage = {
        deletedAt: null,
        coverOf: [{ status: "published" as const }],
        avatarOf: []
      }

      expect(decidePublicAccess("variant", { ...usage, processingStatus: "queued" })).toBe("closed")
      expect(decidePublicAccess("variant", { ...usage, processingStatus: "processing" })).toBe("closed")
      expect(decidePublicAccess("variant", { ...usage, processingStatus: "failed" })).toBe("closed")

      await runMediaProcessing(assetId, { store, storage, processor })

      expect(decidePublicAccess("variant", { ...usage, processingStatus: "ready" })).toBe("public")
      // Сам мастер публичным не становится и после успеха.
      expect(decidePublicAccess("master", { ...usage, processingStatus: "ready" })).toBe("closed")
    })
  })
})
