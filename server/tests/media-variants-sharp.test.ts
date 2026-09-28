import { randomUUID } from "node:crypto"
import sharp from "sharp"
import { beforeEach, describe, expect, it } from "vitest"
import { PLACEHOLDER_WIDTH, VARIANT_WIDTHS } from "../src/media/limits"
import { runMediaProcessing } from "../src/media/pipeline"
import { detectImageFormat } from "../src/media/formats"
import { createSharpImageProcessor } from "../src/media/sharp-processor"
import { acceptMediaUpload, type MediaUploadDeps } from "../src/media/upload"
import { readVariantSet } from "../src/media/variants"
import { parseStorageKey, VARIANT_FORMATS } from "../src/storage/keys"
import {
  createMemoryMediaQueue,
  createMemoryMediaStore,
  createMemoryStorage,
  uploadSourceOf,
  type MemoryMediaStore,
  type MemoryStorage
} from "./helpers/media-memory"

// Критерий 1 задачи T-064: для тестового изображения созданы оба формата всех размеров матрицы.
// Двойник этого не докажет — тест идёт через настоящий `sharp`, ту же реализацию, что работает
// в процессе API, и проверяет байты вариантов, а не записи о них.

const processor = createSharpImageProcessor()

/** Снимок с плавным переходом: однотонная заливка кодируется нетипично хорошо и скрыла бы разницу форматов. */
async function gradientJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      noise: { type: "gaussian", mean: 128, sigma: 30 }
    }
  })
    .jpeg({ quality: 95 })
    .toBuffer()
}

describe("T-064 варианты на настоящем sharp", () => {
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

  const uploadAndProcess = async (bytes: Buffer) => {
    await acceptMediaUpload(
      {
        ownerId: "user-author",
        file: uploadSourceOf(bytes),
        license: "own",
        attribution: "Иван Петров",
        requestId: "request-variants"
      },
      deps
    )
    const outcome = await runMediaProcessing(assetId, { store, storage, processor })
    const record = store.records.get(assetId)!
    return { outcome, record, set: readVariantSet(record.variants) }
  }

  it("критерий 1: оба формата всех ширин матрицы — настоящие AVIF и WebP", { timeout: 120_000 }, async () => {
    const { outcome, set } = await uploadAndProcess(await gradientJpeg(2400, 1600))

    expect(outcome).toEqual({ result: "ready", masterCreated: true })
    expect(set.items).toHaveLength(VARIANT_WIDTHS.length * VARIANT_FORMATS.length)

    for (const item of set.items) {
      const stored = storage.objects.get(item.key)
      expect(stored).toBeDefined()
      // Формат определяется по самим байтам той же проверкой, что и на приёме загрузки:
      // расширение ключа могло бы и соврать (`sharp` зовёт AVIF по контейнеру, `heif`).
      expect(detectImageFormat(stored!.body)?.format).toBe(item.format)
      const metadata = await sharp(stored!.body).metadata()
      expect(metadata.width).toBe(item.width)
      expect(metadata.height).toBe(item.height)
      expect(item.height).toBe(Math.round((item.width * 1600) / 2400))
      expect(item.byteSize).toBe(stored!.body.length)
      expect(stored!.contentType).toBe(`image/${item.format}`)
    }

    const widths = (format: string) => set.items.filter((item) => item.format === format).map((item) => item.width)
    expect(widths("avif")).toEqual([...VARIANT_WIDTHS])
    expect(widths("webp")).toEqual([...VARIANT_WIDTHS])
  })

  it("варианты не несут метаданных мастера", { timeout: 60_000 }, async () => {
    const source = await sharp({ create: { width: 1000, height: 600, channels: 3, background: "#336699" } })
      .withExifMerge({ IFD0: { Make: "Altera", Model: "Test Camera" } })
      .jpeg()
      .toBuffer()

    const { set } = await uploadAndProcess(source)

    for (const item of set.items) {
      const bytes = storage.objects.get(item.key)!.body
      const metadata = await sharp(bytes).metadata()
      expect(metadata.exif).toBeUndefined()
      expect(bytes.includes(Buffer.from("Test Camera"))).toBe(false)
    }
  })

  it("мастер 1000 px даёт 480 и 960 без 1440 и 2000", { timeout: 60_000 }, async () => {
    // Проверяемость `image-variants.md` §5 — тот же случай, что назван в политике.
    const { set } = await uploadAndProcess(await gradientJpeg(1000, 700))

    expect(set.items.map((item) => item.width)).toEqual([480, 960, 480, 960])
    expect(set.items.every((item) => item.width <= 1000)).toBe(true)
    expect(set.thumbnailWidth).toBe(480)
  })

  it("заполнитель — размытая картинка в 48 px, а не ссылка на файл", { timeout: 60_000 }, async () => {
    const { set } = await uploadAndProcess(await gradientJpeg(1200, 800))

    expect(set.placeholder).toMatch(/^data:image\/webp;base64,/)
    const bytes = Buffer.from(set.placeholder!.split(",")[1]!, "base64")
    expect(detectImageFormat(bytes)?.format).toBe("webp")
    expect((await sharp(bytes).metadata()).width).toBe(PLACEHOLDER_WIDTH)
    // Заполнитель показывается до загрузки варианта, поэтому он должен быть дешевле любого из них.
    const smallest = Math.min(...set.items.map((item) => item.byteSize))
    expect(bytes.length).toBeLessThan(smallest)
    expect([...storage.objects.keys()].some((key) => parseStorageKey(key)?.kind === "quarantine")).toBe(false)
  })
})
