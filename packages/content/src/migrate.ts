/**
 * Версия схемы и миграции документов (ADR-0029 п. 4).
 *
 * Версия хранится в самом документе (`attrs.schemaVersion`). Миграции применяются лениво при
 * чтении и навсегда при сохранении: сначала `migrateDocument`, затем `validateDocument`.
 * Пока версия одна, реестр пуст — но он существует, чтобы первое изменение схемы не начиналось
 * с придумывания механизма.
 */

import type { ContentDocument, ContentNode } from "./types"

export const CONTENT_SCHEMA_VERSION = 1

export interface DocumentMigration {
  from: number
  to: number
  migrate(document: ContentNode): ContentNode
}

export const DOCUMENT_MIGRATIONS: readonly DocumentMigration[] = []

export class ContentMigrationError extends Error {
  readonly version: unknown

  constructor(message: string, version: unknown) {
    super(message)
    this.name = "ContentMigrationError"
    this.version = version
  }
}

export interface MigrationOutcome {
  document: ContentDocument
  /** Версия документа до миграций. */
  from: number
  /** Применённые переходы, в порядке применения. */
  applied: string[]
}

/**
 * Приводит документ к текущей версии схемы.
 *
 * Документ более новой версии не понижается: это означало бы потерю данных, записанных кодом,
 * которого здесь ещё нет.
 */
export function migrateDocument(input: unknown): MigrationOutcome {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ContentMigrationError("документ должен быть объектом JSON", undefined)
  }
  const node = input as ContentNode
  const version = (node.attrs as { schemaVersion?: unknown } | undefined)?.schemaVersion
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new ContentMigrationError("в документе нет целой версии схемы attrs.schemaVersion", version)
  }
  if (version > CONTENT_SCHEMA_VERSION) {
    throw new ContentMigrationError(`версия схемы ${version} новее поддерживаемой ${CONTENT_SCHEMA_VERSION}`, version)
  }

  let current: ContentNode = node
  let currentVersion = version
  const applied: string[] = []

  while (currentVersion < CONTENT_SCHEMA_VERSION) {
    const step = DOCUMENT_MIGRATIONS.find((migration) => migration.from === currentVersion)
    if (!step) {
      throw new ContentMigrationError(`нет миграции с версии ${currentVersion}`, currentVersion)
    }
    current = step.migrate(current)
    applied.push(`${step.from}→${step.to}`)
    currentVersion = step.to
  }

  const document = {
    ...current,
    attrs: { ...(current.attrs ?? {}), schemaVersion: CONTENT_SCHEMA_VERSION }
  } as ContentDocument

  return { document, from: version, applied }
}
