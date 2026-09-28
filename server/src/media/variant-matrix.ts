import { VARIANT_FORMATS, type VariantCrop, type VariantFormat } from "../storage/keys"
import { coverCropRect } from "./cover-crops"
import { VARIANT_WIDTHS } from "./limits"
import type { CropRect, FocalPoint } from "./types"

// Матрица вариантов задаётся централизованно (`image-variants.md` §2 п. 1, заметка владельца п. 3):
// один список ширин и форматов на весь продукт, а не набор чисел по компонентам. Числа лежат в
// `limits.ts`; здесь — правила, по которым из них получается план для конкретного мастер-файла.

/**
 * Thumbnail списков и выбора медиа в редакторе — наименьшая ширина матрицы. Отдельного числа тут
 * не вводится: точные точки останова — отдельный проход (журнал §29.12), и до него набор не
 * пополняется шириной, которой владелец не утверждал.
 */
export const THUMBNAIL_WIDTH = VARIANT_WIDTHS[0]

export interface PlannedVariant {
  format: VariantFormat
  width: number
  height: number
  /** Метка кадра; без неё вариант сохраняет композицию мастера. */
  crop?: VariantCrop
  /** Прямоугольник кадра в пикселях мастера; есть только у варианта с меткой. */
  rect?: CropRect
}

export interface MasterSize {
  width: number
  height: number
}

/** Высота варианта — пропорция мастера; меньше пикселя стороны не бывает. */
function scaledHeight(master: MasterSize, width: number): number {
  return Math.max(1, Math.round((master.height * width) / master.width))
}

/**
 * Ширины варианта для мастера: из матрицы берутся те, что не больше мастера — увеличивать
 * изображение конвейер не должен (`image-variants.md` §2 п. 1, §5: мастер 1000 px даёт 480 и 960,
 * без 1440 и 2000).
 *
 * Мастер уже мельче наименьшей ширины матрицы — вариант всё равно нужен: публичен только вариант,
 * сам мастер публичным не бывает (`access-and-signed-urls.md` п. 1–2), и без варианта у готовой
 * записи нечего показать. В этом случае единственная ширина — ширина мастера.
 *
 * Набор ширин приходит аргументом, потому что у аватара он свой — квадратные размеры
 * `avatars.md` п. 3 (`image-variants.md` §3: аватары названы исключением из общей матрицы).
 * Вид файла определяет вызывающий: в записи медиа признака назначения нет, его несёт связь в
 * базе (`storage-layout.md` п. 3).
 */
export function variantWidthsFor(master: MasterSize, widths: readonly number[] = VARIANT_WIDTHS): number[] {
  const fitting = widths.filter((width) => width <= master.width)
  return fitting.length > 0 ? [...fitting] : [master.width]
}

/** Полный план набора: каждая подходящая ширина в каждом публичном формате (журнал §29.4). */
export function planVariants(master: MasterSize, widths?: readonly number[]): PlannedVariant[] {
  const planned = variantWidthsFor(master, widths)
  return VARIANT_FORMATS.flatMap((format) =>
    planned.map((width) => ({ format, width, height: scaledHeight(master, width) }))
  )
}

/**
 * План кадра карточки: тот же набор ширин, но считанный от сторон кадра, а не мастера. Кадр
 * уже, чем мастер, поэтому и ширин у него может быть меньше — увеличивать изображение конвейер
 * не должен и здесь (`image-variants.md` §2 п. 1).
 */
export function planCropVariants(
  master: MasterSize,
  crop: VariantCrop,
  focal: FocalPoint,
  widths?: readonly number[]
): PlannedVariant[] {
  const rect = coverCropRect(master, crop, focal)
  const planned = variantWidthsFor(rect, widths)
  return VARIANT_FORMATS.flatMap((format) =>
    planned.map((width) => ({ format, width, height: scaledHeight(rect, width), crop, rect }))
  )
}

/**
 * Полный план записи: базовые варианты и, если запрошены кадры, варианты каждой метки. Кадры
 * получает только обложка (`article-covers.md` п. 3): обычному медиа статьи обрезка не нужна,
 * внутри текста изображение сохраняет исходную композицию (`image-variants.md` §2 п. 3).
 */
export function planAllVariants(
  master: MasterSize,
  options: { widths?: readonly number[]; crops?: readonly VariantCrop[]; focal?: FocalPoint } = {}
): PlannedVariant[] {
  const base = planVariants(master, options.widths)
  const focal = options.focal
  if (!options.crops || options.crops.length === 0 || !focal) return base
  return [...base, ...options.crops.flatMap((crop) => planCropVariants(master, crop, focal, options.widths))]
}

/** Ширина thumbnail для этого мастера: наименьшая из полученных, если мастер мельче матрицы. */
export function thumbnailWidthFor(master: MasterSize, widths?: readonly number[]): number {
  const planned = variantWidthsFor(master, widths)
  return planned[0] ?? master.width
}
