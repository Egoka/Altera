import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, it } from "vitest"
import { VARIANT_WIDTHS } from "../src/media/limits"
import { runMediaProcessing } from "../src/media/pipeline"
import { acceptMediaUpload, type MediaUploadDeps } from "../src/media/upload"
import { planVariants, thumbnailWidthFor, variantWidthsFor, THUMBNAIL_WIDTH } from "../src/media/variant-matrix"
import { publicVariantSet, readVariantSet } from "../src/media/variants"
import { parseStorageKey, variantKey, VARIANT_FORMATS } from "../src/storage/keys"
import {
  createFakeImageProcessor,
  createMemoryMediaQueue,
  createMemoryMediaStore,
  createMemoryStorage,
  uploadSourceOf,
  type MemoryMediaStore,
  type MemoryStorage
} from "./helpers/media-memory"

// T-064: централизованная матрица вариантов и её шаг в конвейере. Кодирование здесь — двойник:
// настоящие AVIF и WebP проверяет `media-variants-sharp.test.ts`.

const OWNER = "user-author"
const REQUEST = "request-variants"
const jpegBytes = (marker: string): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(marker)])

describe("T-064 матрица вариантов", () => {
  it("ширины и форматы задаются одним списком", () => {
    // Временная матрица журнала §33 п. 2 — ширины ADR-0030; форматы — журнал §29.4.
    expect([...VARIANT_WIDTHS]).toEqual([480, 960, 1440, 2000])
    expect([...VARIANT_FORMATS]).toEqual(["avif", "webp"])
    expect(THUMBNAIL_WIDTH).toBe(480)
  })

  it("не берёт ширины больше мастера", () => {
    // `image-variants.md` §5: мастер 1000 px даёт 480 и 960, без 1440 и 2000.
    expect(variantWidthsFor({ width: 1000, height: 700 })).toEqual([480, 960])
    expect(variantWidthsFor({ width: 2000, height: 1000 })).toEqual([480, 960, 1440, 2000])
    expect(variantWidthsFor({ width: 6000, height: 4000 })).toEqual([480, 960, 1440, 2000])
  })

  it("мастер мельче матрицы всё равно получает вариант своей ширины", () => {
    // Публичен только вариант: без него у готовой записи нечего показать.
    expect(variantWidthsFor({ width: 320, height: 200 })).toEqual([320])
    expect(thumbnailWidthFor({ width: 320, height: 200 })).toBe(320)
  })

  it("план — каждая подходящая ширина в каждом формате, высота по пропорции мастера", () => {
    const plan = planVariants({ width: 1000, height: 500 })

    expect(plan).toHaveLength(4)
    expect(plan.filter((item) => item.format === "avif").map((item) => item.width)).toEqual([480, 960])
    expect(plan.filter((item) => item.format === "webp").map((item) => item.width)).toEqual([480, 960])
    expect(plan.every((item) => item.height === Math.round(item.width / 2))).toBe(true)
  })

  it("высота варианта не опускается ниже пикселя", () => {
    const plan = planVariants({ width: 2000, height: 3 })

    expect(plan.every((item) => item.height >= 1)).toBe(true)
  })
})

describe("T-064 шаг конвейера", () => {
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

  const accept = () =>
    acceptMediaUpload(
      {
        ownerId: OWNER,
        file: uploadSourceOf(jpegBytes("photo")),
        license: "own",
        attribution: "Иван Петров",
        requestId: REQUEST
      },
      deps
    )

  it("критерий 1: у мастера 2400 px есть оба формата всех ширин матрицы", async () => {
    const { processor } = createFakeImageProcessor({ width: 2400, height: 1600 })
    await accept()

    await expect(runMediaProcessing(assetId, { store, storage, processor })).resolves.toEqual({
      result: "ready",
      masterCreated: true
    })

    const record = store.records.get(assetId)!
    const set = readVariantSet(record.variants)
    expect(set.version).toBe(1)
    expect(set.items).toHaveLength(VARIANT_WIDTHS.length * VARIANT_FORMATS.length)
    for (const format of VARIANT_FORMATS) {
      const widths = set.items.filter((item) => item.format === format).map((item) => item.width)
      expect(widths).toEqual([...VARIANT_WIDTHS])
    }
    // Каждый вариант лежит в хранилище по ключу своей раскладки (`storage-layout.md`).
    for (const item of set.items) {
      expect(parseStorageKey(item.key)).toEqual({
        kind: "variant",
        assetId,
        width: item.width,
        format: item.format,
        crop: null
      })
      expect(storage.objects.get(item.key)?.contentType).toBe(`image/${item.format}`)
    }
  })

  it("заполнитель и ширина thumbnail попадают в запись", async () => {
    const { processor, calls } = createFakeImageProcessor({ width: 2400, height: 1600 })
    await accept()

    await runMediaProcessing(assetId, { store, storage, processor })

    const set = readVariantSet(store.records.get(assetId)!.variants)
    expect(set.placeholder?.startsWith("data:image/webp;base64,")).toBe(true)
    expect(set.thumbnailWidth).toBe(THUMBNAIL_WIDTH)
    expect(calls.createPlaceholder).toBe(1)
    // Заполнитель — строка записи: в хранилище лежат только мастер и варианты.
    const kinds = new Set([...storage.objects.keys()].map((key) => parseStorageKey(key)?.kind))
    expect([...kinds].sort()).toEqual(["master", "variant"])
  })

  it("мастер мельче матрицы получает набор своей ширины", async () => {
    const { processor } = createFakeImageProcessor({ width: 300, height: 200 })
    await accept()

    await runMediaProcessing(assetId, { store, storage, processor })

    const set = readVariantSet(store.records.get(assetId)!.variants)
    expect(set.items.map((item) => `${item.format}:${item.width}`)).toEqual(["avif:300", "webp:300"])
    expect(set.thumbnailWidth).toBe(300)
  })

  it("частичная ошибка сохраняет полученные варианты, а повтор доделывает недостающие", async () => {
    // Мастер 1000 px — четыре варианта; третий отказывает (`image-variants.md` §2 п. 8).
    const { processor, calls } = createFakeImageProcessor({
      width: 1000,
      height: 500,
      failVariants: 1,
      failVariantsAfter: 2
    })
    await accept()
    // Отказ на варианте — не отказ содержимого: ошибка уходит наружу, повторы ведёт очередь.
    await expect(runMediaProcessing(assetId, { store, storage, processor })).rejects.toThrow(/Fake variant/)

    const failed = store.records.get(assetId)!
    const partial = readVariantSet(failed.variants)
    expect(failed.processingStatus).toBe("failed")
    expect(partial.items.length).toBeGreaterThan(0)
    expect(partial.items.length).toBeLessThan(4)
    expect(partial.placeholder).not.toBeNull()
    const createdBeforeFailure = calls.createVariant

    const retry = await runMediaProcessing(assetId, { store, storage, processor })

    expect(retry).toEqual({ result: "ready", masterCreated: false })
    const complete = readVariantSet(store.records.get(assetId)!.variants)
    expect(complete.items).toHaveLength(4)
    // Уже сделанные варианты не пересобраны: повтор дошёл только до недостающих.
    expect(calls.createVariant).toBe(createdBeforeFailure + (4 - partial.items.length))
    expect(calls.createPlaceholder).toBe(1)
    expect(calls.createMaster).toBe(1)
  })

  it("повтор по готовой записи не читает мастер и не трогает варианты", async () => {
    const { processor, calls } = createFakeImageProcessor({ width: 1000, height: 500 })
    await accept()
    await runMediaProcessing(assetId, { store, storage, processor })

    await expect(runMediaProcessing(assetId, { store, storage, processor })).resolves.toEqual({
      result: "already_ready"
    })
    expect(calls.createVariant).toBe(4)
  })

  it("потерянный объект варианта восстанавливается повтором", async () => {
    const { processor, calls } = createFakeImageProcessor({ width: 1000, height: 500 })
    await accept()
    await runMediaProcessing(assetId, { store, storage, processor })

    const record = store.records.get(assetId)!
    const lost = variantKey({ assetId, createdAt: record.createdAt, width: 960, format: "webp" })
    storage.objects.delete(lost)
    // Запись возвращается в обработку так же, как это делает повторная загрузка.
    await store.setStatus(assetId, "failed")

    await runMediaProcessing(assetId, { store, storage, processor })

    expect(storage.objects.has(lost)).toBe(true)
    expect(calls.createVariant).toBe(5)
    expect(readVariantSet(store.records.get(assetId)!.variants).items).toHaveLength(4)
  })
})

describe("T-064 чтение набора", () => {
  it("значение колонки по умолчанию читается как «вариантов нет»", () => {
    expect(readVariantSet([])).toEqual({ version: 1, placeholder: null, thumbnailWidth: null, focal: null, items: [] })
    expect(readVariantSet(null).items).toEqual([])
    expect(readVariantSet({ version: 2, items: [{ format: "avif" }] }).items).toEqual([])
  })

  it("записи неизвестной формы в набор не попадают", () => {
    const set = readVariantSet({
      version: 1,
      placeholder: null,
      thumbnailWidth: 480,
      items: [{ format: "gif", width: 480, height: 320, key: "k", byteSize: 1 }, { width: 480 }]
    })

    expect(set.items).toEqual([])
    expect(set.thumbnailWidth).toBe(480)
  })

  it("наружу отдаются адреса, а не ключи бакета", () => {
    const assetId = randomUUID()
    const createdAt = new Date("2026-09-28T10:00:00.000Z")
    const key = variantKey({ assetId, createdAt, width: 960, format: "avif" })

    const set = publicVariantSet(
      {
        version: 1,
        placeholder: "data:image/webp;base64,AAA",
        thumbnailWidth: 480,
        items: [
          { format: "avif", width: 960, height: 640, key, byteSize: 100 },
          // Ключ не варианта публичным адресом не становится.
          { format: "webp", width: 960, height: 640, key: `quarantine/${assetId}.upload`, byteSize: 100 }
        ]
      },
      "https://cdn.altera.test/"
    )

    expect(set.items).toEqual([{ format: "avif", width: 960, height: 640, url: `https://cdn.altera.test/${key}` }])
    expect(set.placeholder).toBe("data:image/webp;base64,AAA")
    expect(set.thumbnailWidth).toBe(480)
  })
})
