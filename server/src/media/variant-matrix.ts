import { VARIANT_FORMATS, type VariantFormat } from "../storage/keys"
import { VARIANT_WIDTHS } from "./limits"

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
 */
export function variantWidthsFor(master: MasterSize): number[] {
  const fitting = VARIANT_WIDTHS.filter((width) => width <= master.width)
  return fitting.length > 0 ? [...fitting] : [master.width]
}

/** Полный план набора: каждая подходящая ширина в каждом публичном формате (журнал §29.4). */
export function planVariants(master: MasterSize): PlannedVariant[] {
  const widths = variantWidthsFor(master)
  return VARIANT_FORMATS.flatMap((format) =>
    widths.map((width) => ({ format, width, height: scaledHeight(master, width) }))
  )
}

/** Ширина thumbnail для этого мастера: наименьшая из полученных, если мастер мельче матрицы. */
export function thumbnailWidthFor(master: MasterSize): number {
  const widths = variantWidthsFor(master)
  return widths[0] ?? master.width
}
