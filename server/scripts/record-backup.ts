/**
 * T-088: отметка прогона резервного копирования.
 *
 *   pnpm --filter server run backup:record -- --kind database --status succeeded --source pg_dump
 *   pnpm --filter server run backup:record -- --kind media --status failed --source bucket-sync \
 *     --completed-at 2026-09-28T03:00:00Z --detail timeout
 *
 * Копии делает эксплуатация вне продукта (`docs/spec/85-media-and-binary/backups.md` п. 1–2):
 * управляемый PostgreSQL и еженедельный `pg_dump`, версионирование и синхронизация бакета медиа.
 * Продукт копии не создаёт и не проверяет их содержимое — он читает отметки прогонов, чтобы
 * показать возраст последней успешной копии в состоянии системы и оповестить о просрочке
 * (`docs/spec/80-observability/health-and-alerts.md` п. 1, 6; журнал §29.9).
 *
 * Эту команду вызывает задание копирования после завершения прогона. Код выхода — 0 при успешной
 * записи, 1 при неверных аргументах, 2 когда запись невозможна (нет `DATABASE_URL` или миграции
 * не применены). В `--detail` не должно быть путей, адресов бакетов и учётных данных: годится
 * короткая техническая пометка вида числа объектов или класса отказа.
 */

import "dotenv/config"
import { PrismaClient } from "../src/generated/prisma"

const KINDS = ["database", "media"] as const
const STATUSES = ["succeeded", "failed"] as const

type Kind = (typeof KINDS)[number]
type Status = (typeof STATUSES)[number]

interface Options {
  kind: Kind
  status: Status
  source: string
  completedAt: Date
  detail: string | null
}

const usage = [
  "Отметка прогона резервного копирования.",
  "",
  "  --kind database|media        вид копии (обязательно)",
  "  --status succeeded|failed    результат прогона (обязательно)",
  "  --source <имя>               чем сделана копия: managed-postgres, pg_dump, bucket-sync",
  "  --completed-at <ISO 8601>    момент завершения; по умолчанию — сейчас",
  "  --detail <текст>             короткая техническая пометка без путей и секретов"
].join("\n")

function fail(message: string): never {
  console.error(`✗ ${message}`)
  console.error("")
  console.error(usage)
  process.exit(1)
}

function parseArgs(argv: readonly string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined) continue
    // `pnpm run … -- --kind …` передаёт разделитель дальше как обычный аргумент.
    if (arg === "--") continue
    if (!arg.startsWith("--")) fail(`неожиданный аргумент: ${arg}`)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith("--")) fail(`у ${arg} нет значения`)
    values.set(arg.slice(2), next)
    index += 1
  }

  const kind = values.get("kind")
  if (!kind || !(KINDS as readonly string[]).includes(kind)) fail("--kind должен быть database или media")
  const status = values.get("status")
  if (!status || !(STATUSES as readonly string[]).includes(status)) {
    fail("--status должен быть succeeded или failed")
  }
  const source = values.get("source")
  if (!source) fail("--source обязателен: чем сделана копия")

  const rawCompletedAt = values.get("completed-at")
  const completedAt = rawCompletedAt ? new Date(rawCompletedAt) : new Date()
  if (Number.isNaN(completedAt.getTime())) fail("--completed-at должен быть датой в формате ISO 8601")

  return {
    kind: kind as Kind,
    status: status as Status,
    source,
    completedAt,
    detail: values.get("detail") ?? null
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("✗ нет DATABASE_URL: отметку записать некуда")
    process.exit(2)
  }

  const options = parseArgs(process.argv.slice(2))
  const prisma = new PrismaClient()
  try {
    const run = await prisma.backupRun.create({
      data: {
        kind: options.kind,
        status: options.status,
        source: options.source,
        completedAt: options.completedAt,
        detail: options.detail
      },
      select: { id: true }
    })
    console.log(`✓ отметка ${options.kind}/${options.status} записана: ${run.id}`)
  } catch (error) {
    console.error("✗ запись отметки не удалась — проверьте, что миграции применены")
    console.error(error instanceof Error ? error.message : error)
    process.exit(2)
  } finally {
    await prisma.$disconnect()
  }
}

void main()
