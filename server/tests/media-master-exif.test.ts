import { randomUUID } from "node:crypto"
import sharp from "sharp"
import { beforeEach, describe, expect, it } from "vitest"
import { runMediaProcessing } from "../src/media/pipeline"
import { createSharpImageProcessor } from "../src/media/sharp-processor"
import { acceptMediaUpload, type MediaUploadDeps } from "../src/media/upload"
import { masterKey } from "../src/storage/keys"
import {
  createMemoryMediaQueue,
  createMemoryMediaStore,
  createMemoryStorage,
  uploadSourceOf,
  type MemoryMediaStore,
  type MemoryStorage
} from "./helpers/media-memory"

// Критерий 1 задачи T-063: в мастер-файле нет EXIF, включая геометку. Двойник обработчика это не
// докажет, поэтому тест идёт через настоящий `sharp` — ту же реализацию, что работает в процессе API.

const GPS_IFD_POINTER = 0x8825
const EXIF_IFD_POINTER = 0x8769

/**
 * Номера тегов EXIF в буфере: хватает разбора каталогов TIFF, чтобы отличить «геометка есть» от
 * «метаданных нет». Буфер `sharp` начинается с заголовка `Exif\0\0`, дальше идёт TIFF.
 */
function exifTags(raw: Buffer): number[] {
  const exif = raw.subarray(0, 4).toString("latin1") === "Exif" ? raw.subarray(6) : raw
  const little = exif.subarray(0, 2).toString("latin1") === "II"
  const u16 = (offset: number) => (little ? exif.readUInt16LE(offset) : exif.readUInt16BE(offset))
  const u32 = (offset: number) => (little ? exif.readUInt32LE(offset) : exif.readUInt32BE(offset))

  const tags: number[] = []
  const readDirectory = (offset: number, depth: number): void => {
    if (depth > 3 || offset + 2 > exif.length) return
    const count = u16(offset)
    for (let index = 0; index < count; index += 1) {
      const entry = offset + 2 + index * 12
      if (entry + 12 > exif.length) return
      const tag = u16(entry)
      tags.push(tag)
      if (tag === GPS_IFD_POINTER || tag === EXIF_IFD_POINTER) readDirectory(u32(entry + 8), depth + 1)
    }
  }
  readDirectory(u32(4), 0)
  return tags
}

/** Есть ли в байтах JPEG сегмент APP1 с EXIF — проверка мастера по самим байтам, не по метаданным. */
function hasExifSegment(jpeg: Buffer): boolean {
  for (let offset = 2; offset + 4 < jpeg.length; ) {
    if (jpeg[offset] !== 0xff) return false
    const marker = jpeg[offset + 1]
    if (marker === 0xda) return false // начало данных изображения
    const length = jpeg.readUInt16BE(offset + 2)
    if (marker === 0xe1 && jpeg.subarray(offset + 4, offset + 8).toString("latin1") === "Exif") return true
    offset += 2 + length
  }
  return false
}

/** Снимок с геометкой и ориентацией 6: именно такие файлы приходят из телефона. */
async function geotaggedJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 640, height: 480, channels: 3, background: "#336699" } })
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: "Altera", Model: "Test Camera" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "55/1 45/1 3000/100",
        GPSLongitudeRef: "E",
        GPSLongitude: "37/1 37/1 1000/100"
      }
    })
    .jpeg()
    .toBuffer()
}

describe("T-063 мастер-файл без EXIF", () => {
  let store: MemoryMediaStore
  let storage: MemoryStorage
  let deps: MediaUploadDeps
  let assetId: string

  const processor = createSharpImageProcessor()

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
        requestId: "request-exif"
      },
      deps
    )
    const outcome = await runMediaProcessing(assetId, { store, storage, processor })
    const record = store.records.get(assetId)!
    const master = storage.objects.get(record.storageKey)
    return { outcome, record, master }
  }

  it("фикстура действительно содержит геометку", async () => {
    const source = await geotaggedJpeg()
    const metadata = await sharp(source).metadata()

    expect(metadata.exif).toBeDefined()
    const tags = exifTags(metadata.exif!)
    expect(tags).toContain(GPS_IFD_POINTER)
    // GPSLatitudeRef, GPSLatitude, GPSLongitudeRef, GPSLongitude внутри каталога GPS.
    expect(tags).toContain(0x1)
    expect(tags).toContain(0x2)
    expect(hasExifSegment(source)).toBe(true)
    expect(metadata.orientation).toBe(6)
  })

  it("в мастер-файле нет ни EXIF, ни геометки", async () => {
    const source = await geotaggedJpeg()

    const { outcome, record, master } = await uploadAndProcess(source)

    expect(outcome).toEqual({ result: "ready", masterCreated: true })
    expect(record.storageKey).toBe(masterKey({ assetId, createdAt: record.createdAt, extension: "jpg" }))
    expect(master).toBeDefined()

    const metadata = await sharp(master!.body).metadata()
    expect(metadata.exif).toBeUndefined()
    expect(metadata.xmp).toBeUndefined()
    expect(metadata.iptc).toBeUndefined()
    expect(hasExifSegment(master!.body)).toBe(false)
    // Ни марка камеры, ни ссылка на широту не остаются даже байтами.
    expect(master!.body.includes(Buffer.from("Altera"))).toBe(false)
    expect(master!.body.includes(Buffer.from("Test Camera"))).toBe(false)
  })

  it("ориентация применена, а не унаследована тегом", async () => {
    const source = await geotaggedJpeg()

    const { record, master } = await uploadAndProcess(source)

    // Ориентация 6 — поворот на 90°: у мастера стороны меняются местами.
    expect(record.width).toBe(480)
    expect(record.height).toBe(640)
    const metadata = await sharp(master!.body).metadata()
    expect(metadata.width).toBe(480)
    expect(metadata.height).toBe(640)
    expect(metadata.orientation).toBeUndefined()
  })

  it("у мастера единый цветовой профиль sRGB", async () => {
    const { master } = await uploadAndProcess(await geotaggedJpeg())

    const metadata = await sharp(master!.body).metadata()
    expect(metadata.space).toBe("srgb")
    expect(metadata.icc).toBeDefined()
  })

  it("PNG обрабатывается тем же путём и сохраняет формат мастера", async () => {
    const source = await sharp({ create: { width: 120, height: 90, channels: 4, background: "#00000000" } })
      .png()
      .toBuffer()

    const { outcome, record } = await uploadAndProcess(source)

    expect(outcome).toEqual({ result: "ready", masterCreated: true })
    expect(record.mimeType).toBe("image/png")
    expect(record.storageKey.endsWith(".png")).toBe(true)
    // Прозрачность сохраняется: мастер — источник всех будущих вариантов.
    expect((await sharp(storage.objects.get(record.storageKey)!.body).metadata()).hasAlpha).toBe(true)
  })

  it("усечённые байты отказывают проверкой целостности", async () => {
    const source = (await geotaggedJpeg()).subarray(0, 200)

    const { outcome, record } = await uploadAndProcess(source)

    expect(outcome).toEqual({ result: "rejected", rule: "file.integrity" })
    expect(record.processingStatus).toBe("failed")
  })
})
