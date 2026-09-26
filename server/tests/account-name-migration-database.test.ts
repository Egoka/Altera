import { randomUUID } from "node:crypto"
import { PrismaClient } from "../src/generated/prisma"
import { describe, expect, it } from "vitest"
import { applyBaselineMigrations, applyMigration } from "./helpers/migration-database"

// T-126: миграция чистит имена, производные от собственного e-mail аккаунта
// (ADR-0018 п. 3, журнал §25.4). Проверяется на настоящем PostgreSQL: правило написано на
// SQL (`split_part`, сравнение без учёта регистра), двойник его не проверяет.

const testDatabaseUrl = process.env.T126_TEST_DATABASE_URL
const targetMigration = "20260927120000_account_name_not_from_email"

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const withDatabase = async (prefix: string, run: (url: string) => Promise<void>): Promise<void> => {
  const name = `${prefix}_${randomUUID().replaceAll("-", "")}`
  const admin = prismaFor(databaseUrl("postgres"))
  const url = databaseUrl(name)

  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    await run(url)
  } finally {
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`
    )
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`)
    await admin.$disconnect()
  }
}

const seedUser = async (prisma: PrismaClient, user: { id: string; name: string; email: string }): Promise<void> => {
  const handle = `${user.id}-handle`
  await prisma.$executeRawUnsafe(`INSERT INTO "handle_history" ("handle", "userId") VALUES ('${handle}', NULL)`)
  await prisma.$executeRawUnsafe(
    `INSERT INTO "users" ("id", "name", "email", "handle", "updatedAt")
     VALUES ('${user.id}', '${user.name}', '${user.email}', '${handle}', NOW())`
  )
  await prisma.$executeRawUnsafe(`UPDATE "handle_history" SET "userId" = '${user.id}' WHERE "handle" = '${handle}'`)
}

describe.skipIf(!testDatabaseUrl)("T-126 миграция имён, производных от e-mail", () => {
  it("очищает имя, равное локальной части своего адреса, и не трогает остальные", async () => {
    await withDatabase("t126_names", async (url) => {
      applyBaselineMigrations(targetMigration, url)
      const before = prismaFor(url)
      // Имя от адреса — ровно та строка, которую писала регистрация до этой задачи.
      await seedUser(before, { id: "derived", name: "ivan.petrov", email: "ivan.petrov@example.test" })
      // Тот же адрес другим регистром остаётся адресом, а не выбранным именем.
      await seedUser(before, { id: "derived-case", name: "Ivan.Petrov", email: "ivan.petrov@other.test" })
      // Своё имя сохраняется.
      await seedUser(before, { id: "chosen", name: "Вера Орлова", email: "vera@example.test" })
      // Совпадение с чужой локальной частью — не повод чистить имя.
      await seedUser(before, { id: "namesake", name: "ivan.petrov", email: "orlova@example.test" })
      // Уже пустое имя остаётся пустым.
      await seedUser(before, { id: "empty", name: "", email: "empty@example.test" })
      await before.$disconnect()

      const migration = applyMigration(targetMigration, url)
      expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)

      const after = prismaFor(url)
      try {
        const users = await after.$queryRawUnsafe<Array<{ id: string; name: string }>>(
          `SELECT "id", "name" FROM "users" ORDER BY "id"`
        )
        expect(users).toEqual([
          { id: "chosen", name: "Вера Орлова" },
          { id: "derived", name: "" },
          { id: "derived-case", name: "" },
          { id: "empty", name: "" },
          { id: "namesake", name: "ivan.petrov" }
        ])

        // AC-2: ни у одного аккаунта имя не равно локальной части его собственного адреса.
        const leftovers = await after.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT "id" FROM "users" WHERE "name" <> '' AND lower("name") = lower(split_part("email", '@', 1))`
        )
        expect(leftovers).toEqual([])
      } finally {
        await after.$disconnect()
      }
    })
  }, 60_000)
})
