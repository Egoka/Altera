import sharp from "sharp"
import type { Metadata, Sharp } from "sharp"
import { descriptorFor, isAcceptedFormat } from "./formats"
import { MASTER_ENCODE_QUALITY } from "./limits"
import { MediaRejectedError, type ImageInspection, type ImageProcessor, type MasterImage } from "./types"

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
    }
  }
}
