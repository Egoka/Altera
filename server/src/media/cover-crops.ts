import { VARIANT_CROPS, type VariantCrop } from "../storage/keys"
import type { CropRect, FocalPoint } from "./types"
import type { MasterSize } from "./variant-matrix"

// Кадрирование обложки под карточки лент (`article-covers.md` п. 3, `image-variants.md` §2 п. 3).
// Здесь — только геометрия: какие соотношения существуют, где внутри мастера лежит кадр и какой
// кадр берёт карточка. Нарезка и ключи — шаг вариантов (`variants.ts`).

/**
 * Соотношения сторон кадра. Числа взяты из действующей вёрстки карточки
 * (`web/app/components/article/Card.vue`): `lede` — герой ленты, широкий; `large` — обычная
 * карточка. Отдельного соотношения под `small` нет: в вёрстке оно совпадает с `large`, а
 * одинаковые кадры разного размера различаются значением `sizes`, не отдельными файлами
 * (`image-variants.md` §2 п. 5).
 */
export const COVER_CROP_RATIOS: Record<VariantCrop, number> = {
  lede: 2 / 1,
  large: 3 / 2
}

/** Варианты карточки (`06-design-system.md` §5) и кадр, которым каждый из них показывается. */
export type ArticleCardVariant = "lede" | "large" | "small"

export const CARD_VARIANT_CROPS: Record<ArticleCardVariant, VariantCrop> = {
  lede: "lede",
  large: "large",
  small: "large"
}

/** Кадры, которые получает обложка: все соотношения матрицы карточек. */
export const COVER_CROPS: readonly VariantCrop[] = VARIANT_CROPS

/** Центр кадра, когда автор фокус не выбирал: середина изображения. */
export const CENTER_FOCAL: FocalPoint = { x: 0.5, y: 0.5 }

/** Фокус из записи медиа; неполная или выходящая за изображение пара читается как центр. */
export function focalOf(asset: { focalX: number | null; focalY: number | null }): FocalPoint {
  const { focalX, focalY } = asset
  if (focalX === null || focalY === null) return CENTER_FOCAL
  if (!isFocalShare(focalX) || !isFocalShare(focalY)) return CENTER_FOCAL
  return { x: focalX, y: focalY }
}

export function isFocalShare(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

export function sameFocal(left: FocalPoint | null, right: FocalPoint | null): boolean {
  if (!left || !right) return left === right
  return left.x === right.x && left.y === right.y
}

/**
 * Кадр заданного соотношения внутри мастера. Берётся наибольший прямоугольник, который
 * помещается целиком, и ставится так же, как его ставит CSS `object-position`: доля фокуса
 * умножается на остаток стороны. Совпадение с CSS — не совпадение случайное, а условие:
 * предпросмотр в редакторе показывает ту же обрезку обычным `object-fit: cover`, и второй
 * реализации той же арифметики на вебе не нужно.
 */
export function focalCropRect(master: MasterSize, ratio: number, focal: FocalPoint): CropRect {
  const wide = master.width / master.height > ratio
  const width = wide ? Math.max(1, Math.round(master.height * ratio)) : master.width
  const height = wide ? master.height : Math.max(1, Math.round(master.width / ratio))
  // Округление вверх могло вывести сторону за границу мастера на пиксель — кадр не должен вылезать.
  const fitted = { width: Math.min(width, master.width), height: Math.min(height, master.height) }

  return {
    x: Math.round((master.width - fitted.width) * focal.x),
    y: Math.round((master.height - fitted.height) * focal.y),
    width: fitted.width,
    height: fitted.height
  }
}

/** Кадр карточки: соотношение метки и фокус записи. */
export function coverCropRect(master: MasterSize, crop: VariantCrop, focal: FocalPoint): CropRect {
  return focalCropRect(master, COVER_CROP_RATIOS[crop], focal)
}
