import { randomUUID } from "node:crypto"
import sharp from "sharp"
import { beforeEach, describe, expect, it } from "vitest"
import { COVER_CROPS } from "../src/media/cover-crops"
import { applyCoverFocal } from "../src/media/covers"
import { runMediaProcessing } from "../src/media/pipeline"
import { createSharpImageProcessor } from "../src/media/sharp-processor"
import { acceptMediaUpload, type MediaUploadDeps } from "../src/media/upload"
import { readVariantSet } from "../src/media/variants"
import {
  createMemoryMediaQueue,
  createMemoryMediaStore,
  createMemoryStorage,
  uploadSourceOf,
  type MemoryMediaStore,
  type MemoryStorage
} from "./helpers/media-memory"

// Кадры обложки на настоящем `sharp` — той же реализации, что работает в процессе API. Двойник
// обработчика показал бы план, но не стороны и не содержимое вырезанных байтов.

const processor = createSharpImageProcessor()

/**
 * Снимок из двух половин: верхняя красная, нижняя синяя. По цвету кадра видно, какую часть
 * мастера он взял, — однотонная заливка этого не показала бы.
 */
async function halvedJpeg(width: number, height: number): Promise<Buffer> {
  const half = Math.floor(height / 2)
  return sharp({ create: { width, height, channels: 3, background: { r: 220, g: 30, b: 30 } } })
    .composite([
      {
        input: { create: { width, height: height - half, channels: 3, background: { r: 30, g: 30, b: 220 } } },
        top: half,
        left: 0
      }
    ])
    .jpeg({ quality: 95 })
    .toBuffer()
}

/** Средний цвет варианта: по нему видно, из какой половины мастера взят кадр. */
async function dominantChannel(body: Buffer): Promise<"red" | "blue" | "mixed"> {
  const { channels } = await sharp(body).stats()
  const [red, , blue] = channels.map((channel) => channel.mean)
  if (red! > blue! * 1.5) return "red"
  if (blue! > red! * 1.5) return "blue"
  return "mixed"
}

describe("T-066 кадры обложки на настоящем sharp", () => {
  let store: MemoryMediaStore
  let storage: MemoryStorage
  let deps: MediaUploadDeps
  let assetId: string

  beforeEach(() => {
    store = createMemoryMediaStore()
    storage = createMemoryStorage()
    assetId = randomUUID()
    deps = { store, storage, queue: createMemoryMediaQueue().queue, newAssetId: () => assetId }
  })

  const upload = async (bytes: Buffer) => {
    await acceptMediaUpload(
      { ownerId: "author-1", file: uploadSourceOf(bytes), license: "own", attribution: "Иван Петров", requestId: "r" },
      deps
    )
    await runMediaProcessing(assetId, { store, storage, processor })
  }

  it("кадр героя из мастера 3:2 — настоящие 2:1 в обоих форматах", async () => {
    await upload(await halvedJpeg(1200, 800))

    const record = await applyCoverFocal(assetId, { x: 0.5, y: 0.5 }, { store, storage, processor })

    const set = readVariantSet(record.variants)
    const lede = set.items.filter((item) => item.crop === "lede")
    expect(lede.map((item) => item.format).sort()).toEqual(["avif", "avif", "webp", "webp"])
    for (const item of lede) {
      const body = (await storage.get(item.key))!.body
      const metadata = await sharp(body).metadata()
      expect(metadata.width).toBe(item.width)
      // Пропорция кадра — ровно 2:1 с точностью до округления стороны.
      expect(Math.abs(metadata.width! / metadata.height! - 2)).toBeLessThan(0.02)
    }
  })

  it("фокус решает, какая часть мастера попадает в кадр", async () => {
    await upload(await halvedJpeg(1200, 800))

    await applyCoverFocal(assetId, { x: 0.5, y: 0 }, { store, storage, processor })
    const top = readVariantSet(store.records.get(assetId)!.variants).items.find(
      (item) => item.crop === "lede" && item.format === "webp"
    )!
    const topColour = await dominantChannel((await storage.get(top.key))!.body)

    await applyCoverFocal(assetId, { x: 0.5, y: 1 }, { store, storage, processor })
    const bottom = readVariantSet(store.records.get(assetId)!.variants).items.find(
      (item) => item.crop === "lede" && item.format === "webp"
    )!
    const bottomColour = await dominantChannel((await storage.get(bottom.key))!.body)

    // Верхняя половина мастера красная, нижняя синяя: смена фокуса меняет содержимое кадра.
    expect(topColour).toBe("red")
    expect(bottomColour).toBe("blue")
    // Ключ при этом тот же: фокуса в нём нет, байты под ним переписаны.
    expect(bottom.key).toBe(top.key)
  })

  it("базовые варианты композицию мастера сохраняют", async () => {
    await upload(await halvedJpeg(1200, 800))

    const record = await applyCoverFocal(assetId, { x: 0.5, y: 0 }, { store, storage, processor })

    const item = readVariantSet(record.variants).items.find(
      (entry) => entry.crop === undefined && entry.format === "webp"
    )!
    const body = (await storage.get(item.key))!.body
    const metadata = await sharp(body).metadata()

    expect(Math.abs(metadata.width! / metadata.height! - 1.5)).toBeLessThan(0.02)
    expect(await dominantChannel(body)).toBe("mixed")
    expect(COVER_CROPS.length).toBe(2)
  })
})
