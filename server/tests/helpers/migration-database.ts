import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const serverRoot = path.resolve(__dirname, "../..")
const migrationsRoot = path.join(serverRoot, "prisma/migrations")
const schemaPath = path.join(serverRoot, "prisma/schema.prisma")

const migrationFile = (migration: string): string => path.join(migrationsRoot, migration, "migration.sql")

const prismaDbExecute = (source: string[], url: string, input?: string): SpawnSyncReturns<string> =>
  spawnSync("pnpm", ["exec", "prisma", "db", "execute", ...source, "--schema", schemaPath], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url },
    encoding: "utf8",
    input
  })

// Каталоги миграций старше целевой в порядке имён — тот же порядок, что у `prisma migrate deploy`.
export const migrationsBefore = (target: string): string[] =>
  readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name < target)
    .map((entry) => entry.name)
    .sort()

// `prisma db execute` отправляет скрипт одним простым запросом, а PostgreSQL выполняет такой запрос одной
// неявной транзакцией до ближайшего явного COMMIT. COMMIT после каждого файла сохраняет границы прежних
// отдельных вызовов: каждая миграция фиксируется сама, и новое значение enum одной миграции не попадает
// в транзакцию следующей. Пустой оператор `;` закрывает последний оператор файла, если в нём нет точки
// с запятой; COMMIT без открытой транзакции даёт только предупреждение.
export const baselineMigrationScript = (target: string): string =>
  migrationsBefore(target)
    .map((migration) => `-- migration: ${migration}\n${readFileSync(migrationFile(migration), "utf8")}\n;\nCOMMIT;\n`)
    .join("\n")

const commandOutput = (result: SpawnSyncReturns<string>): string =>
  [result.error?.message, result.stdout, result.stderr].filter(Boolean).join("\n")

// Все миграции до целевой — одним запуском Prisma CLI вместо запуска на каждую миграцию.
export const applyBaselineMigrations = (target: string, url: string): void => {
  const result = prismaDbExecute(["--stdin"], url, baselineMigrationScript(target))
  if (result.status !== 0) {
    throw new Error(`Baseline migrations before ${target} failed:\n${commandOutput(result)}`)
  }
}

// Целевая миграция — отдельным запуском, чтобы тест проверял её собственный код выхода.
export const applyMigration = (migration: string, url: string): SpawnSyncReturns<string> =>
  prismaDbExecute(["--file", migrationFile(migration)], url)
