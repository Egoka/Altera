import sharp from "sharp"
import type { Metadata, Sharp } from "sharp"
import { descriptorFor, isAcceptedFormat } from "./formats"
import {
  MASTER_ENCODE_QUALITY,
  PLACEHOLDER_BLUR,
  PLACEHOLDER_QUALITY,
  PLACEHOLDER_WIDTH,
  VARIANT_ENCODE_QUALITY
} from "./limits"
import {
  MediaRejectedError,
  type ImageInspection,
  type ImageProcessor,
  type MasterImage,
  type PlaceholderImage,
  type VariantImage
} from "./types"

// Обработка изображений на `sharp` (ADR-0030 п. 3: `sharp` — обычная зависимость сервера,
// варианты и мастер делаются при загрузке, а не на лету).

/**
 * Мастер — не сырые байты загрузки (§29.2): изображение декодируется и кодируется заново. Это
 * единственный способ одновременно снять все метаданные, применить ориентацию EXIF и привести
 * цветовой профиль к единому представлению. `sharp` по умолчанию не переносит метаданные входа в
 * выход, поэтому EXIF, XMP и IPTC в мастер не попадают; ICC задаётся явно.
 */
function encodeMaster(pipeline: Sharp, format: string): Sharp {
  switch (format) {
    case "jpeg":
      // 4:4:4 — без прореживания цвета: мастер служит источником всех будущих вариантов.
      return pipeline.jpeg({ quality: MASTER_ENCODE_QUALITY.jpeg, chromaSubsampling: "4:4:4" })
    case "png":
      return pipeline.png({ compressionLevel: 9 })
    case "webp":
      return pipeline.webp({ quality: MASTER_ENCODE_QUALITY.webp })
    case "avif":
      return pipeline.avif({ quality: MASTER_ENCODE_QUALITY.avif })
    default:
      throw new MediaRejectedError("file.type", `Unsupported master format: ${format}`)
  }
}

export function createSharpImageProcessor(): ImageProcessor {
  return {
    name: "sharp",

    async inspect(bytes) {
      let metadata: Metadata
      try {
        // `failOn: "error"` отклоняет усечённые и повреждённые байты — это проверка целостности.
        metadata = await sharp(bytes, { failOn: "error", animated: true }).metadata()
      } catch (error) {
        throw new MediaRejectedError("file.integrity", `Image could not be decoded: ${String(error)}`)
      }

      const format = metadata.format
      if (!format || !isAcceptedFormat(format)) {
        throw new MediaRejectedError("file.type", `Unsupported image format: ${format ?? "unknown"}`)
      }

      // При `animated: true` высота — сумма кадров, поэтому размер кадра берётся из `pageHeight`.
      const frames = metadata.pages ?? 1
      const width = metadata.width ?? 0
      const height = metadata.pageHeight ?? metadata.height ?? 0
      if (width < 1 || height < 1) {
        throw new MediaRejectedError("file.integrity", "Image has no readable dimensions")
      }

      const inspection: ImageInspection = {
        format,
        width,
        height,
        frames,
        hasMetadata: Boolean(metadata.exif || metadata.icc || metadata.iptc || metadata.xmp)
      }
      return inspection
    },

    async createMaster(bytes, inspection) {
      const descriptor = descriptorFor(inspection.format)
      const pipeline = sharp(bytes, { failOn: "error" })
        // `rotate()` без угла применяет ориентацию EXIF и снимает сам тег.
        .rotate()
        .toColourspace("srgb")
        .withIccProfile("srgb")

      const { data, info } = await encodeMaster(pipeline, inspection.format).toBuffer({ resolveWithObject: true })
      const master: MasterImage = {
        body: data,
        mimeType: descriptor.mimeType,
        extension: descriptor.extension,
        width: info.width,
        height: info.height
      }
      return master
    },

    /**
     * Вариант делается из мастера, а не из байтов загрузки: мастер — источник всех производных
     * (§29.2). Ориентация и цветовой профиль в нём уже приведены, поэтому здесь остаётся только
     * масштабирование и кодирование. `withoutEnlargement` держит правило «не больше мастера»
     * даже если в план попала бо́льшая ширина.
     */
    async createVariant(master, { width, format }) {
      const pipeline = sharp(master, { failOn: "error" }).resize({ width, withoutEnlargement: true })
      const encoded =
        format === "avif"
          ? pipeline.avif({ quality: VARIANT_ENCODE_QUALITY.avif })
          : pipeline.webp({ quality: VARIANT_ENCODE_QUALITY.webp })

      const { data, info } = await encoded.toBuffer({ resolveWithObject: true })
      const variant: VariantImage = {
        body: data,
        mimeType: `image/${format}`,
        width: info.width,
        height: info.height
      }
      return variant
    },

    /**
     * Заполнитель — WebP: он читается всеми браузерами, которым вообще показывается сайт, и
     * поэтому не требует второго формата. Прозрачность мастера сохраняется, чтобы заполнитель
     * PNG-логотипа не превращался в чёрный прямоугольник.
     */
    async createPlaceholder(master) {
      const { data, info } = await sharp(master, { failOn: "error" })
        .resize({ width: PLACEHOLDER_WIDTH, withoutEnlargement: true })
        .blur(PLACEHOLDER_BLUR)
        .webp({ quality: PLACEHOLDER_QUALITY, alphaQuality: PLACEHOLDER_QUALITY })
        .toBuffer({ resolveWithObject: true })

      const placeholder: PlaceholderImage = {
        dataUri: `data:image/webp;base64,${data.toString("base64")}`,
        width: info.width,
        height: info.height
      }
      return placeholder
    }
  }
}
