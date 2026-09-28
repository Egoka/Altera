import { randomUUID } from "node:crypto"
import sharp from "sharp"
import { beforeEach, describe, expect, it } from "vitest"
import { acceptAvatarUpload, type AvatarUploadDeps } from "../src/media/avatars"
import { detectImageFormat } from "../src/media/formats"
import { AVATAR_VARIANT_WIDTHS } from "../src/media/limits"
import { createSharpImageProcessor } from "../src/media/sharp-processor"
import { readVariantSet } from "../src/media/variants"
import {
  createMemoryMediaStore,
  createMemoryStorage,
  uploadSourceOf,
  type MemoryMediaStore,
  type MemoryStorage
} from "./helpers/media-memory"

// Кадрирование и квадратный набор аватара на настоящем `sharp` — той же реализации, что работает
// в процессе API. Двойник обработчика показал бы только план, но не байты.

const processor = createSharpImageProcessor()

/** Снимок с шумом: однотонная заливка кодируется нетипично и скрыла бы разницу размеров. */
async function noisyJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 30 } } })
    .jpeg({ quality: 95 })
    .toBuffer()
}

/** Тот же снимок, но записанный «на боку» с ориентацией EXIF 6 — так его отдаёт телефон. */
async function turnedJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 30 } } })
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 95 })
    .toBuffer()
}

describe("T-065 аватар на настоящем sharp", () => {
  let store: MemoryMediaStore
  let storage: MemoryStorage
  let deps: AvatarUploadDeps
  let assetId: string

  beforeEach(() => {
    store = createMemoryMediaStore()
    storage = createMemoryStorage()
    assetId = randomUUID()
    deps = { store, storage, processor, newAssetId: () => assetId }
  })

  const accept = (bytes: Buffer, crop?: { x: number; y: number; size: number }) =>
    acceptAvatarUpload({ ownerId: "author-1", file: uploadSourceOf(bytes), crop, requestId: "request-1" }, deps)

  it("кадр автора даёт квадратный мастер без метаданных", async () => {
    const record = await accept(await noisyJpeg(1200, 800), { x: 100, y: 50, size: 600 })

    expect(record.width).toBe(600)
    expect(record.height).toBe(600)

    const master = await storage.get(record.storageKey)
    const metadata = await sharp(master!.body).metadata()
    expect(metadata.width).toBe(600)
    expect(metadata.height).toBe(600)
    expect(metadata.exif).toBeUndefined()
  })

  it("кадр считается по изображению, как его видит автор: ориентация EXIF уже применена", async () => {
    // В файле 1200×800, на экране — 800×1200: по стороне 800 квадрат 800 помещается, а по
    // записанной в файл ширине 1200 он был бы смещён.
    const record = await accept(await turnedJpeg(1200, 800), { x: 0, y: 400, size: 800 })

    expect({ width: record.width, height: record.height }).toEqual({ width: 800, height: 800 })
  })

  it("без кадра берёт центральный квадрат наибольшей стороны", async () => {
    const record = await accept(await noisyJpeg(1000, 400))

    expect({ width: record.width, height: record.height }).toEqual({ width: 400, height: 400 })
  })

  it("собирает квадратные варианты 64…512 в AVIF и WebP и заполнитель", async () => {
    const record = await accept(await noisyJpeg(1200, 800))
    const set = readVariantSet(record.variants)

    expect(set.items).toHaveLength(AVATAR_VARIANT_WIDTHS.length * 2)
    expect(set.placeholder).toMatch(/^data:image\/webp;base64,/)

    for (const item of set.items) {
      const object = await storage.get(item.key)
      // Формат читается по сигнатуре: `sharp` называет AVIF контейнером `heif`.
      expect(detectImageFormat(object!.body)?.format).toBe(item.format)
      const metadata = await sharp(object!.body).metadata()
      expect(metadata.width).toBe(item.width)
      expect(metadata.height).toBe(item.width)
    }
  })

  it("квадрат за границей изображения не принимается", async () => {
    await expect(accept(await noisyJpeg(400, 400), { x: 100, y: 0, size: 400 })).rejects.toMatchObject({
      extensions: { code: "VALIDATION_ERROR", field: "crop", rule: "bounds" }
    })
    expect(store.records.size).toBe(0)
  })
})
