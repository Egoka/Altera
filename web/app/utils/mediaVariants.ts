/**
 * Разбор набора вариантов медиафайла и сборка источников для `<picture>`.
 *
 * Набор приходит из API полем `variants` (журнал §29.4, `docs/spec/85-media-and-binary/image-variants.md`
 * §2 п. 5): варианты сделаны при загрузке, обработки на лету нет — `/_ipx/` не используется
 * (ADR-0030 п. 1–2). Поле объявлено как `JSON`, поэтому значение проверяется здесь, а не типом.
 */

/** Публичные форматы вариантов; порядок — порядок предпочтения в `<picture>` (AVIF первым). */
export const MEDIA_VARIANT_FORMATS = ["avif", "webp"] as const

export type MediaVariantFormat = (typeof MEDIA_VARIANT_FORMATS)[number]

/**
 * Метки кадра обложки (`article-covers.md` п. 3). Вариант без метки сохраняет композицию
 * мастера — так показывается изображение в тексте и шапке материала.
 */
export const MEDIA_VARIANT_CROPS = ["lede", "large"] as const

export type MediaVariantCrop = (typeof MEDIA_VARIANT_CROPS)[number]

/**
 * Кадр, которым показывается каждый вариант карточки (`06-design-system.md` §5). `small` и
 * `large` делят один кадр: в вёрстке у них одно соотношение, а разный размер задаётся `sizes`,
 * не отдельными файлами (`image-variants.md` §2 п. 5).
 */
export const CARD_VARIANT_CROPS = {
  lede: "lede",
  large: "large",
  small: "large"
} as const satisfies Record<string, MediaVariantCrop>

export interface MediaVariant {
  format: MediaVariantFormat
  width: number
  height: number
  url: string
  crop?: MediaVariantCrop
}

export interface MediaVariants {
  /** Размытый заполнитель строкой `data:`; `null`, если конвейер его ещё не сделал. */
  placeholder: string | null
  /** Ширина варианта для списков и выбора медиа в редакторе. */
  thumbnailWidth: number | null
  variants: MediaVariant[]
}

const EMPTY: MediaVariants = { placeholder: null, thumbnailWidth: null, variants: [] }

function isVariant(value: unknown): value is MediaVariant {
  if (typeof value !== "object" || value === null) return false
  const item = value as Partial<MediaVariant>
  const cropKnown = item.crop === undefined || (MEDIA_VARIANT_CROPS as readonly string[]).includes(item.crop as string)
  return (
    (MEDIA_VARIANT_FORMATS as readonly string[]).includes(item.format as string) &&
    typeof item.width === "number" &&
    item.width > 0 &&
    typeof item.height === "number" &&
    item.height > 0 &&
    typeof item.url === "string" &&
    item.url.length > 0 &&
    cropKnown
  )
}

/**
 * Значение поля `variants` в набор. Запись без вариантов (обработка не дошла или не удалась)
 * читается как пустой набор: показывать нечего, и страница выводит запасное состояние, а не
 * сломанную картинку.
 */
export function readMediaVariants(value: unknown): MediaVariants {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return EMPTY
  const set = value as { placeholder?: unknown; thumbnailWidth?: unknown; items?: unknown }
  const items = Array.isArray(set.items) ? set.items.filter(isVariant) : []
  return {
    placeholder: typeof set.placeholder === "string" && set.placeholder.length > 0 ? set.placeholder : null,
    thumbnailWidth: typeof set.thumbnailWidth === "number" ? set.thumbnailWidth : null,
    // По возрастанию ширины: так `srcset` читается человеком и совпадает с порядком выбора браузера.
    variants: items.slice().sort((left, right) => left.width - right.width)
  }
}

export function variantsOfFormat(set: MediaVariants, format: MediaVariantFormat): MediaVariant[] {
  return set.variants.filter((variant) => variant.format === format)
}

/**
 * Набор одного кадра. Без метки остаются варианты исходной композиции; с меткой — кадры карточки.
 * Кадра в наборе может не быть (обычное медиа статьи кадров не получает) — тогда набор пуст, и
 * место использования само решает, показывать ли исходную композицию.
 */
export function variantsOfCrop(set: MediaVariants, crop: MediaVariantCrop | null): MediaVariants {
  return {
    ...set,
    variants: set.variants.filter((variant) => (variant.crop ?? null) === crop)
  }
}

/** `srcset` одного формата: браузер выбирает ширину сам по `sizes` (ADR-0030 п. 2). */
export function variantSrcset(set: MediaVariants, format: MediaVariantFormat): string {
  return variantsOfFormat(set, format)
    .map((variant) => `${variant.url} ${variant.width}w`)
    .join(", ")
}

/**
 * Вариант для `src` у `<img>`: самый широкий WebP. WebP, а не AVIF — `src` читает браузер, не
 * выбравший ни одного `<source>`, и запасной формат для него надёжнее (журнал §29.4).
 */
export function fallbackVariant(set: MediaVariants): MediaVariant | null {
  const webp = variantsOfFormat(set, "webp")
  const list = webp.length > 0 ? webp : set.variants
  return list[list.length - 1] ?? null
}

/** Вариант для списков и выбора медиа в редакторе: ширина thumbnail, иначе самый узкий. */
export function thumbnailVariant(set: MediaVariants, format: MediaVariantFormat = "webp"): MediaVariant | null {
  const list = variantsOfFormat(set, format)
  if (list.length === 0) return null
  return list.find((variant) => variant.width === set.thumbnailWidth) ?? list[0] ?? null
}

export interface PictureSource {
  type: string
  srcset: string
}

export interface PictureSources {
  sources: PictureSource[]
  fallback: MediaVariant | null
  fallbackSrcset: string
  placeholder: string | null
}

/**
 * Источники `<picture>`: AVIF, затем WebP запасным (журнал §29.4). Формат без вариантов
 * источником не становится — пустой `srcset` заставил бы браузер выбрать несуществующий файл.
 */
export function pictureSources(value: unknown, crop: MediaVariantCrop | null = null): PictureSources {
  const whole = readMediaVariants(value)
  // Кадра нет — берётся исходная композиция: пустой `<picture>` показал бы дыру там, где
  // картинка есть, просто не обрезанная.
  const cropped = variantsOfCrop(whole, crop)
  const set = cropped.variants.length > 0 ? cropped : variantsOfCrop(whole, null)
  const sources = MEDIA_VARIANT_FORMATS.map((format) => ({
    type: `image/${format}`,
    srcset: variantSrcset(set, format)
  })).filter((source) => source.srcset.length > 0)

  return {
    sources,
    fallback: fallbackVariant(set),
    fallbackSrcset: variantSrcset(set, "webp") || variantSrcset(set, "avif"),
    placeholder: set.placeholder
  }
}
