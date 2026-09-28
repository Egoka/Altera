import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, it } from "vitest"
import {
  CARD_VARIANT_CROPS,
  CENTER_FOCAL,
  COVER_CROP_RATIOS,
  COVER_CROPS,
  coverCropRect,
  focalCropRect,
  focalOf
} from "../src/media/cover-crops"
import { applyCoverFocal, coverViewOf, isCoverReady } from "../src/media/covers"
import { runMediaProcessing } from "../src/media/pipeline"
import { acceptMediaUpload, type MediaUploadDeps } from "../src/media/upload"
import { planAllVariants } from "../src/media/variant-matrix"
import { cropsFor, readVariantSet } from "../src/media/variants"
import { VARIANT_WIDTHS } from "../src/media"
import { parseStorageKey, VARIANT_FORMATS } from "../src/storage/keys"
import {
  createFakeImageProcessor,
  createMemoryMediaQueue,
  createMemoryMediaStore,
  createMemoryStorage,
  uploadSourceOf,
  type MemoryMediaStore,
  type MemoryStorage
} from "./helpers/media-memory"

// T-066: кадрирование обложки по фокусной точке (`article-covers.md` п. 3,
// `image-variants.md` §2 п. 3). Кодирование здесь — двойник: настоящую обрезку `sharp`
// проверяет `media-covers-sharp.test.ts`.

const OWNER = "user-author"
const REQUEST = "request-cover"
const MEDIA_BASE = "https://media.example/altera"
const jpegBytes = (marker: string): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(marker)])

describe("T-066 геометрия кадра", () => {
  it("соотношения карточек: герой шире обычной карточки, `small` делит кадр с `large`", () => {
    expect(COVER_CROP_RATIOS.lede).toBe(2)
    expect(COVER_CROP_RATIOS.large).toBe(1.5)
    // Одинаковые кадры разного размера различаются `sizes`, а не файлами (§2 п. 5).
    expect(CARD_VARIANT_CROPS).toEqual({ lede: "lede", large: "large", small: "large" })
    expect([...COVER_CROPS]).toEqual(["lede", "large"])
  })

  it("кадр — наибольший прямоугольник соотношения внутри мастера", () => {
    // Мастер 3:2 уже, чем 2:1 — кадр героя теряет высоту, ширина остаётся полной.
    expect(coverCropRect({ width: 2400, height: 1600 }, "lede", CENTER_FOCAL)).toEqual({
      x: 0,
      y: 200,
      width: 2400,
      height: 1200
    })
    // Мастер шире 2:1 — кадр теряет ширину, высота остаётся полной.
    expect(coverCropRect({ width: 3000, height: 1000 }, "lede", CENTER_FOCAL)).toEqual({
      x: 500,
      y: 0,
      width: 2000,
      height: 1000
    })
    // Соотношение мастера совпадает с соотношением кадра — обрезать нечего.
    expect(coverCropRect({ width: 2400, height: 1600 }, "large", CENTER_FOCAL)).toEqual({
      x: 0,
      y: 0,
      width: 2400,
      height: 1600
    })
  })

  it("фокус двигает кадр так же, как CSS `object-position`", () => {
    // Доля фокуса умножается на остаток стороны: 0 — прижат к началу, 1 — к концу.
    expect(focalCropRect({ width: 2400, height: 1600 }, 2, { x: 0.5, y: 0 })).toMatchObject({ y: 0 })
    expect(focalCropRect({ width: 2400, height: 1600 }, 2, { x: 0.5, y: 1 })).toMatchObject({ y: 400 })
    expect(focalCropRect({ width: 3000, height: 1000 }, 2, { x: 0.25, y: 0.5 })).toMatchObject({ x: 250 })
  })

  it("кадр не выходит за мастер, даже когда сторона округляется вверх", () => {
    const rect = focalCropRect({ width: 999, height: 1000 }, 999 / 1000, { x: 1, y: 1 })

    expect(rect.x + rect.width).toBeLessThanOrEqual(999)
    expect(rect.y + rect.height).toBeLessThanOrEqual(1000)
  })

  it("фокус записи: без пары или вне изображения — центр", () => {
    expect(focalOf({ focalX: 0.2, focalY: 0.8 })).toEqual({ x: 0.2, y: 0.8 })
    expect(focalOf({ focalX: null, focalY: 0.8 })).toEqual(CENTER_FOCAL)
    expect(focalOf({ focalX: 1.5, focalY: 0.5 })).toEqual(CENTER_FOCAL)
  })

  it("кадры получает только запись с фокусом: у аватара и медиа статьи их нет", () => {
    expect(cropsFor({ focalX: null, focalY: null })).toEqual([])
    expect(cropsFor({ focalX: 0.5, focalY: 0.5 })).toEqual(COVER_CROPS)
  })

  it("план кадра считает ширины от сторон кадра, а не мастера", () => {
    // Кадр героя из мастера 1000×1000 — 1000×500: ширины матрицы те же, высоты — пополам.
    const plan = planAllVariants({ width: 1000, height: 1000 }, { crops: ["lede"], focal: CENTER_FOCAL })
    const lede = plan.filter((item) => item.crop === "lede" && item.format === "webp")

    expect(lede.map((item) => item.width)).toEqual([480, 960])
    expect(lede.every((item) => item.height === Math.round(item.width / 2))).toBe(true)
    expect(plan.filter((item) => item.crop === undefined)).toHaveLength(VARIANT_FORMATS.length * 2)
  })
})

describe("T-066 набор вариантов обложки", () => {
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

  const uploadAndProcess = async (size = { width: 2400, height: 1600 }) => {
    const fake = createFakeImageProcessor(size)
    await acceptMediaUpload(
      {
        ownerId: OWNER,
        file: uploadSourceOf(jpegBytes("cover")),
        license: "own",
        attribution: "Иван Петров",
        requestId: REQUEST
      },
      deps
    )
    await runMediaProcessing(assetId, { store, storage, processor: fake.processor })
    return fake
  }

  it("до выбора обложки кадров нет: обычное медиа статьи их не получает", async () => {
    await uploadAndProcess()

    const set = readVariantSet(store.records.get(assetId)!.variants)
    expect(set.items.every((item) => item.crop === undefined)).toBe(true)
    expect(set.focal).toBeNull()
  })

  it("выбор обложки добавляет кадры карточек, не трогая базовые варианты", async () => {
    const fake = await uploadAndProcess()
    const baseCalls = fake.calls.createVariant

    const record = await applyCoverFocal(assetId, { x: 0.25, y: 0.75 }, { store, storage, processor: fake.processor })

    const set = readVariantSet(record.variants)
    expect(set.focal).toEqual({ x: 0.25, y: 0.75 })
    for (const crop of COVER_CROPS) {
      const widths = set.items.filter((item) => item.crop === crop && item.format === "webp").map((item) => item.width)
      expect(widths).toEqual([...VARIANT_WIDTHS])
    }
    // Базовые варианты остались прежними: пересозданы только кадры.
    expect(set.items.filter((item) => item.crop === undefined)).toHaveLength(
      VARIANT_WIDTHS.length * VARIANT_FORMATS.length
    )
    expect(fake.calls.createVariant - baseCalls).toBe(
      COVER_CROPS.length * VARIANT_WIDTHS.length * VARIANT_FORMATS.length
    )

    // Метка кадра входит в ключ: кадр и базовый вариант той же ширины — разные объекты.
    for (const item of set.items) {
      expect(parseStorageKey(item.key)).toMatchObject({ kind: "variant", crop: item.crop ?? null })
      expect(storage.objects.has(item.key)).toBe(true)
    }
  })

  it("кадр вырезается по выбранному фокусу", async () => {
    const fake = await uploadAndProcess()
    fake.variantCrops.length = 0

    await applyCoverFocal(assetId, { x: 0.5, y: 0 }, { store, storage, processor: fake.processor })

    // Фокус прижат к верху: кадр героя начинается с первой строки мастера.
    const lede = fake.variantCrops.filter((crop) => crop && crop.height === 1200)
    expect(lede.length).toBeGreaterThan(0)
    expect(lede.every((crop) => crop!.y === 0)).toBe(true)
  })

  it("смена фокуса пересобирает кадры и не трогает базовые варианты", async () => {
    const fake = await uploadAndProcess()
    await applyCoverFocal(assetId, { x: 0.5, y: 0 }, { store, storage, processor: fake.processor })
    const afterFirst = fake.calls.createVariant

    const record = await applyCoverFocal(assetId, { x: 0.5, y: 1 }, { store, storage, processor: fake.processor })

    const cropCount = COVER_CROPS.length * VARIANT_WIDTHS.length * VARIANT_FORMATS.length
    expect(fake.calls.createVariant - afterFirst).toBe(cropCount)
    expect(readVariantSet(record.variants).focal).toEqual({ x: 0.5, y: 1 })
  })

  it("повтор с тем же фокусом ничего не пересоздаёт", async () => {
    const fake = await uploadAndProcess()
    await applyCoverFocal(assetId, { x: 0.5, y: 0.5 }, { store, storage, processor: fake.processor })
    const afterFirst = fake.calls.createVariant

    await applyCoverFocal(assetId, { x: 0.5, y: 0.5 }, { store, storage, processor: fake.processor })

    expect(fake.calls.createVariant).toBe(afterFirst)
  })

  it("снятый фокус убирает кадры: без него запись — обычное медиа статьи", async () => {
    // Центр по умолчанию подставляет выбор обложки (`article/cover.ts`), а сам порт принимает
    // и пустое значение: тогда запись перестаёт быть обложкой и кадров не несёт.
    const fake = await uploadAndProcess()
    await applyCoverFocal(assetId, CENTER_FOCAL, { store, storage, processor: fake.processor })

    const record = await applyCoverFocal(assetId, null, { store, storage, processor: fake.processor })

    expect(readVariantSet(record.variants).items.every((item) => item.crop === undefined)).toBe(true)
    expect(readVariantSet(record.variants).focal).toBeNull()
  })

  it("обложка для ответа API: адрес исходной композиции и полный набор", async () => {
    const fake = await uploadAndProcess()
    const record = await applyCoverFocal(assetId, CENTER_FOCAL, { store, storage, processor: fake.processor })

    const view = coverViewOf({ ...record, alt: null }, MEDIA_BASE)!

    expect(view.assetId).toBe(assetId)
    // Один адрес для `<img>` — наибольший WebP без кадра: шапка материала показывает композицию.
    expect(view.url).toBe(`${MEDIA_BASE}/${record.storageKey.slice(0, 7)}/${assetId}/w2000.webp`)
    expect(view.focal).toEqual(CENTER_FOCAL)
    expect(view.variants.items.some((item) => item.crop === "lede")).toBe(true)
    expect(isCoverReady({ ...record, alt: null })).toBe(true)
  })

  it("незаконченная запись обложкой не считается", async () => {
    const fake = await uploadAndProcess()
    const record = store.records.get(assetId)!

    expect(coverViewOf({ ...record, alt: null, processingStatus: "queued" }, MEDIA_BASE)).toBeNull()
    expect(coverViewOf({ ...record, alt: null, deletedAt: new Date() }, MEDIA_BASE)).toBeNull()
    // Кадров ещё нет — к публикации такая обложка не готова (§29.1: карточке нечего показать).
    expect(isCoverReady({ ...record, alt: null })).toBe(false)
    void fake
  })
})
