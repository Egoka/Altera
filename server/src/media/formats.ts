import { ACCEPTED_IMAGE_FORMATS, type AcceptedImageFormat, type ImageFormatDescriptor } from "./types"

// Тип определяется по содержимому, а не по расширению и не по объявленному `content-type`
// (`upload-pipeline.md` п. 3): имя файла и заголовок задаёт клиент, и доверять им нельзя.

const DESCRIPTORS: Readonly<Record<AcceptedImageFormat, ImageFormatDescriptor>> = {
  jpeg: { format: "jpeg", mimeType: "image/jpeg", extension: "jpg" },
  png: { format: "png", mimeType: "image/png", extension: "png" },
  webp: { format: "webp", mimeType: "image/webp", extension: "webp" },
  avif: { format: "avif", mimeType: "image/avif", extension: "avif" }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const startsWith = (bytes: Buffer, signature: Buffer, offset = 0): boolean =>
  bytes.length >= offset + signature.length && bytes.subarray(offset, offset + signature.length).equals(signature)

const AVIF_BRANDS = new Set(["avif", "avis"])

/**
 * ISO BMFF: бокс `ftyp` с основным брендом и списком совместимых. AVIF отличается от HEIC именно
 * брендом, поэтому читаются все бренды бокса, а не только основной. Размер бокса из файла
 * ограничивается длиной байтов: обманутый размер не уводит чтение за пределы буфера.
 */
function isAvif(bytes: Buffer): boolean {
  if (bytes.length < 16 || bytes.subarray(4, 8).toString("latin1") !== "ftyp") return false
  const boxSize = bytes.readUInt32BE(0)
  const end = Math.min(bytes.length, boxSize >= 16 ? boxSize : bytes.length)
  for (let offset = 8; offset + 4 <= end; offset += 4) {
    if (AVIF_BRANDS.has(bytes.subarray(offset, offset + 4).toString("latin1"))) return true
  }
  return false
}

/** Формат по сигнатуре содержимого; всё, что этот проход не принимает, — `null`. */
export function detectImageFormat(bytes: Buffer): ImageFormatDescriptor | null {
  if (startsWith(bytes, Buffer.from([0xff, 0xd8, 0xff]))) return DESCRIPTORS.jpeg
  if (startsWith(bytes, PNG_SIGNATURE)) return DESCRIPTORS.png
  if (startsWith(bytes, Buffer.from("RIFF", "latin1")) && startsWith(bytes, Buffer.from("WEBP", "latin1"), 8)) {
    return DESCRIPTORS.webp
  }
  if (isAvif(bytes)) return DESCRIPTORS.avif
  return null
}

export function descriptorFor(format: AcceptedImageFormat): ImageFormatDescriptor {
  return DESCRIPTORS[format]
}

export function isAcceptedFormat(value: string): value is AcceptedImageFormat {
  return (ACCEPTED_IMAGE_FORMATS as readonly string[]).includes(value)
}
