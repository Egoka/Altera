/**
 * Бинарные данные для локальной базы разработки: процедурные изображения без внешних
 * зависимостей.
 *
 * Оригиналы — PNG (кодировщик ниже, только `zlib`). Варианты из них собирает конвейер сервера
 * (`src/media/variants.ts`), а в хранилище их кладёт его же локальный адаптер.
 */
import { stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { deflateSync } from "node:zlib"

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // глубина
  header[9] = 2 // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0))
  ])
}

// ---------------------------------------------------------------------------
// Процедурные изображения
// ---------------------------------------------------------------------------

type Rgb = [number, number, number]

const PALETTES: Rgb[][] = [
  [
    [27, 38, 59],
    [65, 90, 119],
    [224, 225, 221]
  ],
  [
    [52, 78, 65],
    [88, 129, 87],
    [218, 215, 205]
  ],
  [
    [94, 48, 35],
    [192, 133, 82],
    [243, 233, 220]
  ],
  [
    [38, 70, 83],
    [42, 157, 143],
    [233, 196, 106]
  ],
  [
    [61, 52, 139],
    [118, 120, 237],
    [247, 184, 1]
  ],
  [
    [20, 33, 61],
    [252, 163, 17],
    [229, 229, 229]
  ],
  [
    [73, 80, 87],
    [173, 181, 189],
    [248, 249, 250]
  ],
  [
    [106, 4, 15],
    [208, 0, 0],
    [255, 186, 8]
  ],
  [
    [3, 4, 94],
    [0, 119, 182],
    [144, 224, 239]
  ],
  [
    [40, 54, 24],
    [96, 108, 56],
    [254, 250, 224]
  ],
  [
    [88, 49, 1],
    [153, 88, 42],
    [255, 230, 167]
  ],
  [
    [43, 45, 66],
    [141, 153, 174],
    [239, 35, 60]
  ]
]

/** Детерминированный генератор для одного изображения — картинка зависит только от зерна. */
function seeded(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Обложка: небо с градиентом, солнце и три гряды холмов — «пейзаж» в цветах палитры рубрики. */
export function renderCover(width: number, height: number, seed: number, paletteIndex: number): Buffer {
  const rnd = seeded(seed)
  const [dark, mid, light] = PALETTES[paletteIndex % PALETTES.length]
  const sun = { x: (0.15 + rnd() * 0.7) * width, y: (0.18 + rnd() * 0.3) * height, r: (0.06 + rnd() * 0.08) * width }
  // Дальняя гряда светлее ближней — воздушная перспектива.
  const ridges = [0, 1, 2].map((k) => ({
    base: height * (0.5 + k * 0.14 + rnd() * 0.06),
    amp1: height * (0.05 + rnd() * 0.07),
    amp2: height * (0.02 + rnd() * 0.03),
    f1: (1.5 + rnd() * 2.5) / width,
    f2: (6 + rnd() * 8) / width,
    p1: rnd() * 10,
    p2: rnd() * 10,
    color: [0, 1, 2].map((c) => mix(mid[c], dark[c], 0.35 + k * 0.3)) as Rgb
  }))
  const pixels = new Uint8Array(width * height * 3)
  for (let x = 0; x < width; x += 1) {
    const ridgeY = ridges.map(
      (ridge) =>
        ridge.base +
        ridge.amp1 * Math.sin(x * ridge.f1 * Math.PI + ridge.p1) +
        ridge.amp2 * Math.sin(x * ridge.f2 * Math.PI + ridge.p2)
    )
    for (let y = 0; y < height; y += 1) {
      // Небо: от цвета палитры сверху к светлому у горизонта.
      const t = Math.min(1, y / (height * 0.7))
      let color: Rgb = [mix(mid[0], light[0], t), mix(mid[1], light[1], t), mix(mid[2], light[2], t)]
      const d = Math.hypot(x - sun.x, y - sun.y) / sun.r
      if (d < 1) color = [mix(255, light[0], 0.25), mix(255, light[1], 0.25), mix(255, light[2], 0.25)]
      else if (d < 2.2) {
        const glow = 0.35 * (1 - (d - 1) / 1.2)
        color = [mix(color[0], 255, glow), mix(color[1], 255, glow), mix(color[2], 255, glow)]
      }
      for (let k = 0; k < ridges.length; k += 1) if (y >= ridgeY[k]) color = ridges[k].color
      const offset = (y * width + x) * 3
      pixels[offset] = color[0]
      pixels[offset + 1] = color[1]
      pixels[offset + 2] = color[2]
    }
  }
  return encodePng(width, height, pixels)
}

/** Аватар: фон палитры и силуэт «голова и плечи». */
export function renderAvatar(size: number, seed: number, paletteIndex: number): Buffer {
  const rnd = seeded(seed)
  const [dark, mid, light] = PALETTES[paletteIndex % PALETTES.length]
  const background = rnd() < 0.5 ? mid : light
  const figure = background === light ? dark : light
  const pixels = new Uint8Array(size * size * 3)
  const head = { x: size / 2, y: size * 0.4, r: size * 0.19 }
  const shoulders = { x: size / 2, y: size * 1.02, r: size * 0.42 }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside =
        Math.hypot(x - head.x, y - head.y) < head.r || Math.hypot(x - shoulders.x, y - shoulders.y) < shoulders.r
      const shade = 1 - (y / size) * 0.15
      const color = inside ? figure : background
      const offset = (y * size + x) * 3
      pixels[offset] = color[0] * shade
      pixels[offset + 1] = color[1] * shade
      pixels[offset + 2] = color[2] * shade
    }
  }
  return encodePng(size, size, pixels)
}

// ---------------------------------------------------------------------------
// Локальное хранилище
// ---------------------------------------------------------------------------

export async function byteSize(root: string, key: string): Promise<number> {
  return (await stat(join(resolve(root), key))).size
}

/** Ограниченный параллелизм: кодирование вариантов занимает пул потоков `sharp`. */
export async function inPool<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      await task(item)
    }
  })
  await Promise.all(workers)
}
