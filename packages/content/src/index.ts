/**
 * `@altera/content` — схема документа материала, валидация, экстракторы и рендер.
 *
 * Один источник для редактора, сервера и страницы материала (ADR-0001, ADR-0029).
 * Порядок чтения сохранённого документа: `migrateDocument` → `validateDocument` → рендер.
 */

export * from "./types"
export * from "./schema"
export * from "./migrate"
export * from "./validate"
export * from "./extract"
export * from "./render"
export * from "./create"

import { migrateDocument } from "./migrate"
import { assertValidDocument, type ValidationLimits } from "./validate"
import type { ContentDocument } from "./types"

/**
 * Чтение сохранённого документа: поднять версию схемы и проверить по каталогу.
 * Бросает `ContentMigrationError` или `ContentInvalidError`.
 */
export function readDocument(input: unknown, limits?: Partial<ValidationLimits>): ContentDocument {
  const { document } = migrateDocument(input)
  return assertValidDocument(document, limits)
}
