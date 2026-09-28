import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, it } from "vitest"
import {
  acceptAvatarUpload,
  avatarUrlOf,
  avatarViewOf,
  centerSquare,
  type AvatarUploadDeps
} from "../src/media/avatars"
import { AVATAR_VARIANT_WIDTHS, MAX_UPLOAD_BYTES } from "../src/media/limits"
import { readVariantSet } from "../src/media/variants"
import { decidePublicAccess } from "../src/storage/access"
import { parseStorageKey, quarantineKey, variantKey } from "../src/storage/keys"
import {
  createFakeImageProcessor,
  createMemoryMediaStore,
  createMemoryStorage,
  uploadSourceOf,
  type MemoryMediaStore,
  type MemoryStorage
} from "./helpers/media-memory"

// Приём аватара T-065: кадр автора, квадратный набор вариантов и готовая запись к ответу мутации
// (`avatars.md` п. 2–4, журнал §29.5). Точность обрезки и настоящие AVIF/WebP — на `sharp`
// в `media-avatar-sharp.test.ts`; связь с аккаунтом — в `account-avatar.test.ts`.

const OWNER = "user-author"
const REQUEST = "request-1"
const MEDIA_BASE = "https://media.altera.test"

const jpegBytes = (marker: string): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(marker)])
const gifBytes = (): Buffer => Buffer.concat([Buffer.from("GIF89a"), Buffer.from("gif-body")])

describe("T-065 приём аватара", () => {
  let store: MemoryMediaStore
  let storage: MemoryStorage
  let processor: ReturnType<typeof createFakeImageProcessor>
  let deps: AvatarUploadDeps
  let assetId: string

  beforeEach(() => {
    store = createMemoryMediaStore()
    storage = createMemoryStorage()
    // Исходник 1200×800: кадр по умолчанию — центральный квадрат 800×800.
    processor = createFakeImageProcessor({ width: 1200, height: 800 })
    assetId = randomUUID()
    deps = { store, storage, processor: processor.processor, newAssetId: () => assetId }
  })

  const accept = (overrides: Partial<Parameters<typeof acceptAvatarUpload>[0]> = {}) =>
    acceptAvatarUpload(
      { ownerId: OWNER, file: uploadSourceOf(jpegBytes("portrait")), requestId: REQUEST, ...overrides },
      deps
    )

  describe("критерий 1: аватар готов к ответу мутации, без ожидания очереди", () => {
    it("доводит запись до ready в одном вызове", async () => {
      const record = await accept()

      expect(record.processingStatus).toBe("ready")
      expect(store.statusHistory(assetId)).toEqual(["uploading", "queued", "processing", "ready"])
      // Карантин снят: наружу отдаются только варианты.
      expect(storage.objects.has(quarantineKey({ assetId }))).toBe(false)
    })

    it("готовый аватар неархивированного аккаунта публичен", () => {
      expect(
        decidePublicAccess("variant", {
          deletedAt: null,
          processingStatus: "ready",
          coverOf: [],
          avatarOf: [{ archivedAt: null }]
        })
      ).toBe("public")
    })
  })

  describe("квадратный набор вариантов (`avatars.md` п. 3)", () => {
    it("собирает 64, 128, 256 и 512 в AVIF и WebP, а не матрицу медиа статьи", async () => {
      const record = await accept()
      const set = readVariantSet(record.variants)

      expect([...new Set(set.items.map((item) => item.width))].sort((a, b) => a - b)).toEqual([
        ...AVATAR_VARIANT_WIDTHS
      ])
      expect(set.items.filter((item) => item.format === "avif")).toHaveLength(AVATAR_VARIANT_WIDTHS.length)
      expect(set.items.filter((item) => item.format === "webp")).toHaveLength(AVATAR_VARIANT_WIDTHS.length)
      expect(set.thumbnailWidth).toBe(64)
      // Стороны квадратные: кадр применён до мастера.
      expect(set.items.every((item) => item.width === item.height)).toBe(true)
      expect(set.items.every((item) => parseStorageKey(item.key)?.kind === "variant")).toBe(true)
    })

    it("не увеличивает мастер: кадр мельче матрицы даёт единственную ширину кадра", async () => {
      const record = await accept({ crop: { x: 0, y: 0, size: 48 } })
      const set = readVariantSet(record.variants)

      expect([...new Set(set.items.map((item) => item.width))]).toEqual([48])
    })
  })

  describe("кадрирование", () => {
    it("без аргумента берёт наибольший центральный квадрат", async () => {
      await accept()

      expect(processor.lastCrop()).toEqual({ x: 200, y: 0, size: 800 })
      expect(centerSquare({ width: 1200, height: 800 })).toEqual({ x: 200, y: 0, size: 800 })
    })

    it("применяет кадр автора до карантина", async () => {
      const record = await accept({ crop: { x: 10, y: 20, size: 400 } })

      expect(processor.lastCrop()).toEqual({ x: 10, y: 20, size: 400 })
      expect(record.width).toBe(400)
      expect(record.height).toBe(400)
    })

    it("отклоняет квадрат за границей изображения", async () => {
      await expect(accept({ crop: { x: 900, y: 0, size: 400 } })).rejects.toMatchObject({
        extensions: { code: "VALIDATION_ERROR", field: "crop", rule: "bounds" }
      })
      expect(store.records.size).toBe(0)
      expect(storage.objects.size).toBe(0)
    })

    it("отклоняет дробные координаты и нулевую сторону", async () => {
      await expect(accept({ crop: { x: 0.5, y: 0, size: 100 } })).rejects.toMatchObject({
        extensions: { code: "VALIDATION_ERROR", field: "crop", rule: "integer" }
      })
      await expect(accept({ crop: { x: 0, y: 0, size: 0 } })).rejects.toMatchObject({
        extensions: { code: "VALIDATION_ERROR", field: "crop", rule: "min" }
      })
    })
  })

  describe("проверки файла", () => {
    it("отклоняет формат вне справочника по содержимому, а не по расширению", async () => {
      await expect(accept({ file: uploadSourceOf(gifBytes()) })).rejects.toMatchObject({
        extensions: { code: "VALIDATION_ERROR", field: "file", rule: "unsupportedType" }
      })
    })

    it("отклоняет объявленный размер больше порога до чтения байтов", async () => {
      let read = false
      const file = {
        size: MAX_UPLOAD_BYTES + 1,
        bytes: async () => {
          read = true
          return jpegBytes("portrait")
        }
      }
      await expect(accept({ file })).rejects.toMatchObject({
        extensions: { code: "VALIDATION_ERROR", field: "file", rule: "maxSize" }
      })
      expect(read).toBe(false)
    })

    it("отказ содержимого возвращается автору ошибкой, а не молчаливой записью", async () => {
      processor = createFakeImageProcessor({ width: 8, height: 8 })
      deps = { ...deps, processor: processor.processor }

      await expect(accept()).rejects.toMatchObject({
        extensions: { code: "VALIDATION_ERROR", field: "file", rule: "file.minSide" }
      })
    })

    it("лицензия и атрибуция у аватара не запрашиваются", async () => {
      const record = await accept()

      expect(record.attribution).toBe("")
      expect(record.license).toBe("own")
    })
  })

  describe("показ аватара", () => {
    it("отдаёт адрес наибольшего варианта WebP и полный набор", async () => {
      const record = await accept()
      const view = avatarViewOf(
        { id: record.id, processingStatus: record.processingStatus, deletedAt: null, variants: record.variants },
        MEDIA_BASE
      )

      expect(view?.assetId).toBe(assetId)
      expect(view?.url).toBe(
        `${MEDIA_BASE}/${variantKey({ assetId, createdAt: record.createdAt, width: 512, format: "webp" })}`
      )
      expect(view?.variants.items).toHaveLength(AVATAR_VARIANT_WIDTHS.length * 2)
      expect(view?.variants.placeholder).toMatch(/^data:image\/webp;base64,/)
    })

    it("неготовая, удалённая и пустая запись аватаром не считаются — показываются инициалы", async () => {
      const record = await accept()
      const asset = {
        id: record.id,
        processingStatus: record.processingStatus,
        deletedAt: null,
        variants: record.variants
      }

      expect(avatarUrlOf(null, MEDIA_BASE)).toBeNull()
      expect(avatarUrlOf({ ...asset, deletedAt: new Date() }, MEDIA_BASE)).toBeNull()
      expect(avatarUrlOf({ ...asset, processingStatus: "processing" }, MEDIA_BASE)).toBeNull()
      expect(avatarUrlOf({ ...asset, variants: [] }, MEDIA_BASE)).toBeNull()
    })
  })
})
