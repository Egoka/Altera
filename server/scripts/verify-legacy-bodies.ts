/**
 * T-020: проверка конвертируемости тел материалов в документ `content`.
 *
 *   pnpm verify:legacy-bodies
 *
 * Скрипт читает все тела материалов из трёх источников — legacy-поле `articles.body`,
 * `article_translations.body` и `article_revisions.body` — прогоняет каждое через SQL-функцию
 * конверсии `t020_legacy_body_to_document` (единственная реализация алгоритма, живёт в миграции
 * `20260928120000_legacy_body_content_document`) и проверяет результат настоящим валидатором
 * каталога: `readDocument` из `@altera/content` — это `migrateDocument` плюс `validateDocument`.
 *
 * Так проверяется именно тот код, который выполняет конверсию, а не его пересказ на TypeScript.
 *
 * Скрипт ничего не изменяет: только `SELECT`. Код выхода — 0, если неконвертируемых тел нет;
 * 1, если есть; 2, если проверку выполнить нельзя (нет `DATABASE_URL` или не применены миграции).
 *
 * `articles.body` остаётся строковым legacy-полем и после конверсии: его снятие требует
 * перевода резолверов на языковые версии (API cutover) и в объём T-020 не входит. Поэтому
 * строки в этом источнике — ожидаемое состояние, а не дефект; важно, что все они конвертируемы.
 */

import "dotenv/config"
import { ContentInvalidError, ContentMigrationError, readDocument } from "@altera/content"
import { PrismaClient } from "../src/generated/prisma"

/** Размер порции: тела читаются пачками, чтобы большая база не оказалась целиком в памяти. */
const BATCH_SIZE = 200

/** Сколько проблемных идентификаторов показать: перечислять тысячи строк бессмысленно. */
const REPORTED_IDS = 10

interface BodySource {
  /** Как источник называется в выводе. */
  label: string
  table: string
  /** Выражение, дающее тело как `jsonb`. */
  bodyExpression: string
  note?: string
}

const SOURCES: BodySource[] = [
  {
    label: "articles.body",
    table: "articles",
    bodyExpression: `to_jsonb("body")`,
    note: "legacy-поле TEXT, остаётся источником записи до перевода API на языковые версии"
  },
  { label: "article_translations.body", table: "article_translations", bodyExpression: `"body"` },
  { label: "article_revisions.body", table: "article_revisions", bodyExpression: `"body"` }
]

interface BodyRow {
  id: string
  isDocument: boolean
  /** Результат конверсии; `null` — функция отказалась конвертировать тело. */
  document: unknown
}

interface SourceReport {
  label: string
  note?: string
  total: number
  documents: number
  legacy: number
  rejected: string[]
  invalid: Array<{ id: string; reason: string }>
}

/** Адрес базы без пароля: строка подключения в вывод и evidence не попадает. */
function describeDatabase(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    return `${url.hostname}:${url.port || "5432"}${url.pathname}`
  } catch {
    return "адрес не разобран"
  }
}

async function conversionFunctionExists(prisma: PrismaClient): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_proc WHERE proname = 't020_legacy_body_to_document'
     ) AS "exists"`
  )
  return rows[0]?.exists === true
}

async function readSource(prisma: PrismaClient, source: BodySource): Promise<SourceReport> {
  const report: SourceReport = {
    label: source.label,
    note: source.note,
    total: 0,
    documents: 0,
    legacy: 0,
    rejected: [],
    invalid: []
  }

  let cursor = ""
  for (;;) {
    const rows = await prisma.$queryRawUnsafe<BodyRow[]>(
      `SELECT
         "id",
         "t020_is_content_document"(${source.bodyExpression}) AS "isDocument",
         "t020_legacy_body_to_document"(${source.bodyExpression}) AS "document"
       FROM "${source.table}"
       WHERE "id" > $1
       ORDER BY "id"
       LIMIT ${BATCH_SIZE}`,
      cursor
    )
    if (rows.length === 0) break

    for (const row of rows) {
      report.total += 1
      if (row.isDocument) report.documents += 1
      else report.legacy += 1

      if (row.document === null || row.document === undefined) {
        report.rejected.push(row.id)
        continue
      }
      try {
        readDocument(row.document)
      } catch (error) {
        report.invalid.push({ id: row.id, reason: describeFailure(error) })
      }
    }

    cursor = rows[rows.length - 1]!.id
  }

  return report
}

/** Причина отказа валидатора каталога в одну строку. */
function describeFailure(error: unknown): string {
  if (error instanceof ContentInvalidError) {
    return error.errors.map((issue) => `${issue.path}: ${issue.code}`).join("; ")
  }
  if (error instanceof ContentMigrationError) {
    return `версия схемы: ${String(error.version)}`
  }
  return error instanceof Error ? error.message : String(error)
}

function printReport(report: SourceReport): void {
  const unconvertible = report.rejected.length + report.invalid.length
  console.log(`\n${report.label}${report.note ? ` — ${report.note}` : ""}`)
  console.log(`  всего тел:              ${report.total}`)
  console.log(`  документ content:       ${report.documents}`)
  console.log(`  legacy-тел:             ${report.legacy}`)
  console.log(`  неконвертируемых:       ${unconvertible}`)

  if (report.rejected.length > 0) {
    console.log(`  функция конверсии отказала (${report.rejected.length}):`)
    for (const id of report.rejected.slice(0, REPORTED_IDS)) console.log(`    ${id}`)
  }
  if (report.invalid.length > 0) {
    console.log(`  результат не прошёл каталог (${report.invalid.length}):`)
    for (const entry of report.invalid.slice(0, REPORTED_IDS)) console.log(`    ${entry.id} — ${entry.reason}`)
  }
}

async function main(): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error("DATABASE_URL не задан: проверять нечего")
    return 2
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  try {
    console.log("Проверка конвертируемости тел материалов в документ content (T-020)")
    console.log(`База: ${describeDatabase(databaseUrl)}`)

    if (!(await conversionFunctionExists(prisma))) {
      console.error(
        "\nВ базе нет функции t020_legacy_body_to_document: примените миграции" +
          " (pnpm --filter server run prisma:migrate:deploy) и повторите проверку"
      )
      return 2
    }

    const reports: SourceReport[] = []
    for (const source of SOURCES) reports.push(await readSource(prisma, source))
    for (const report of reports) printReport(report)

    const total = reports.reduce((sum, report) => sum + report.total, 0)
    const documents = reports.reduce((sum, report) => sum + report.documents, 0)
    const legacy = reports.reduce((sum, report) => sum + report.legacy, 0)
    const unconvertible = reports.reduce((sum, report) => sum + report.rejected.length + report.invalid.length, 0)

    console.log(`\nИтого: ${total} тел, ${documents} документов, ${legacy} legacy, ${unconvertible} неконвертируемых`)
    return unconvertible === 0 ? 0 : 1
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  })
