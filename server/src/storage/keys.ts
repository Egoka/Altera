// Раскладка ключей хранилища (`storage-layout.md` п. 3–4). Ключ непрозрачен: в нём только дата,
// UUID записи и техническое расширение — ни имени файла, ни данных пользователя (ADR-0011 п. 3).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Расширения мастер-файлов изображений (ADR-0008 п. 6). */
export const MASTER_EXTENSIONS = ["jpg", "png", "webp", "avif", "gif"] as const
/** Форматы публичных вариантов (журнал §29.4). */
export const VARIANT_FORMATS = ["avif", "webp"] as const
/** Формат выгрузки аккаунта (`exports.md` п. 2 — ZIP `[ДОПУЩЕНИЕ]`). */
export const EXPORT_EXTENSIONS = ["zip"] as const

export type MasterExtension = (typeof MASTER_EXTENSIONS)[number]
export type VariantFormat = (typeof VARIANT_FORMATS)[number]
export type ExportExtension = (typeof EXPORT_EXTENSIONS)[number]

export type ParsedStorageKey =
  | { kind: "master"; assetId: string; extension: MasterExtension }
  | { kind: "variant"; assetId: string; width: number; format: VariantFormat }
  | { kind: "export"; userId: string; exportId: string; extension: ExportExtension }

const MAX_VARIANT_WIDTH = 10_000

function assertUuid(value: string, name: string): void {
  if (!UUID.test(value)) throw new Error(`${name} must be a lowercase UUID`)
}

function assertOneOf<T extends string>(value: string, allowed: readonly T[], name: string): asserts value is T {
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`Unsupported ${name}`)
}

function assertWidth(width: number): void {
  if (!Number.isInteger(width) || width < 1 || width > MAX_VARIANT_WIDTH) throw new Error("Invalid variant width")
}

// Месяц берётся из даты создания записи в UTC, чтобы ключ не зависел от часового пояса сервера.
function datePrefix(createdAt: Date): string {
  if (Number.isNaN(createdAt.getTime())) throw new Error("Invalid createdAt")
  const month = String(createdAt.getUTCMonth() + 1).padStart(2, "0")
  return `${createdAt.getUTCFullYear()}/${month}`
}

export function masterKey(input: { assetId: string; createdAt: Date; extension: MasterExtension }): string {
  assertUuid(input.assetId, "assetId")
  assertOneOf(input.extension, MASTER_EXTENSIONS, "master extension")
  return `${datePrefix(input.createdAt)}/${input.assetId}.${input.extension}`
}

export function variantKey(input: { assetId: string; createdAt: Date; width: number; format: VariantFormat }): string {
  assertUuid(input.assetId, "assetId")
  assertWidth(input.width)
  assertOneOf(input.format, VARIANT_FORMATS, "variant format")
  return `${datePrefix(input.createdAt)}/${input.assetId}/w${input.width}.${input.format}`
}

export function exportKey(input: { userId: string; exportId: string; extension: ExportExtension }): string {
  assertUuid(input.userId, "userId")
  assertUuid(input.exportId, "exportId")
  assertOneOf(input.extension, EXPORT_EXTENSIONS, "export extension")
  return `exports/${input.userId}/${input.exportId}.${input.extension}`
}

const MASTER_KEY = /^(\d{4})\/(0[1-9]|1[0-2])\/([0-9a-f-]{36})\.([a-z]+)$/
const VARIANT_KEY = /^(\d{4})\/(0[1-9]|1[0-2])\/([0-9a-f-]{36})\/w(\d{1,5})\.([a-z]+)$/
const EXPORT_KEY = /^exports\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.([a-z]+)$/

const isOneOf = <T extends string>(value: string, allowed: readonly T[]): value is T =>
  (allowed as readonly string[]).includes(value)

/** Разбирает ключ; всё, что не соответствует раскладке, — `null` (в том числе `..` и лишние сегменты). */
export function parseStorageKey(key: string): ParsedStorageKey | null {
  const master = MASTER_KEY.exec(key)
  if (master) {
    const [, , , assetId, extension] = master
    if (!UUID.test(assetId) || !isOneOf(extension, MASTER_EXTENSIONS)) return null
    return { kind: "master", assetId, extension }
  }
  const variant = VARIANT_KEY.exec(key)
  if (variant) {
    const [, , , assetId, rawWidth, format] = variant
    const width = Number(rawWidth)
    if (!UUID.test(assetId) || !isOneOf(format, VARIANT_FORMATS)) return null
    if (width < 1 || width > MAX_VARIANT_WIDTH || rawWidth.startsWith("0")) return null
    return { kind: "variant", assetId, width, format }
  }
  const exported = EXPORT_KEY.exec(key)
  if (exported) {
    const [, userId, exportId, extension] = exported
    if (!UUID.test(userId) || !UUID.test(exportId) || !isOneOf(extension, EXPORT_EXTENSIONS)) return null
    return { kind: "export", userId, exportId, extension }
  }
  return null
}

export function isStorageKey(key: string): boolean {
  return parseStorageKey(key) !== null
}
