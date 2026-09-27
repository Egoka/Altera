import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { createStaff, deactivateOwner, revokeOwner } from "../src/admin/staff"
import { createUserWithReservedHandle } from "../src/auth/handle"
import { PrismaClient, type User } from "../src/generated/prisma"
import type { GraphQLContext } from "../src/prisma"
import { applyBaselineMigrations } from "./helpers/migration-database"

/**
 * T-133 на настоящем PostgreSQL. Двойник здесь бесполезен дважды: инвариант «хотя бы один
 * владелец» держится на блокировке строк — второй отзыв обязан дождаться коммита первого и
 * пересчитать владельцев уже без снятого (write skew на READ COMMITTED, журнал #10); а
 * атомарность создания служебной записи видна только по откату настоящей транзакции.
 *
 * Запускается при заданном `T133_TEST_DATABASE_URL`.
 */
const testDatabaseUrl = process.env.T133_TEST_DATABASE_URL
// Имя старше любого каталога миграций: применяются все миграции по порядку.
const afterAllMigrations = "99999999999999_after_all"

const now = new Date("2026-09-27T12:00:00.000Z")

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const withDatabase = async (run: (database: PrismaClient) => Promise<void>): Promise<void> => {
  const name = `t133_${randomUUID().replaceAll("-", "")}`
  const admin = prismaFor(databaseUrl("postgres"))
  const url = databaseUrl(name)
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    applyBaselineMigrations(afterAllMigrations, url)
    const database = prismaFor(url)
    try {
      await run(database)
    } finally {
      await database.$disconnect()
    }
  } finally {
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`
    )
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`)
    await admin.$disconnect()
  }
}

const createOwner = (database: PrismaClient, email: string, name: string): Promise<User> =>
  createUserWithReservedHandle(database, { email, name, locale: "ru", role: "owner", isServiceAccount: true })

/** Контекст действующего владельца; `piiHasher.email` подменяется там, где нужен сбой второго шага. */
const ownerContext = (
  database: PrismaClient,
  actor: Pick<User, "id" | "role">,
  overrides: Partial<{ emailHash: (value: string) => string }> = {}
): GraphQLContext =>
  ({
    currentUser: {
      id: actor.id,
      role: actor.role,
      archivedAt: null,
      planTier: "free",
      planUntil: null,
      permissionExceptions: []
    },
    requestId: "req-t133",
    prisma: database,
    cache: { delByTags: vi.fn().mockResolvedValue(undefined) },
    mail: { send: vi.fn().mockResolvedValue({}) },
    piiHasher: { email: overrides.emailHash ?? (() => "email-digest"), ip: (value: string) => value },
    logger: { log: vi.fn() }
  }) as unknown as GraphQLContext

const activeOwners = (database: PrismaClient): Promise<{ id: string }[]> =>
  database.$queryRaw<{ id: string }[]>`SELECT "id" FROM "users" WHERE "role" = 'owner' AND "archivedAt" IS NULL`

const conflictReason = (results: PromiseSettledResult<unknown>[]): unknown => {
  const rejected = results.find((result) => result.status === "rejected")
  return rejected?.status === "rejected" ? rejected.reason : null
}

describe.skipIf(!testDatabaseUrl)("T-133 инвариант владельцев в PostgreSQL", () => {
  // AC-1: два параллельных отзыва друг друга единственными двумя владельцами.
  it("на два встречных отзыва оставляет ровно одного владельца", async () => {
    await withDatabase(async (database) => {
      const first = await createOwner(database, "t133-first@altera.test", "Первый владелец")
      const second = await createOwner(database, "t133-second@altera.test", "Второй владелец")

      const results = await Promise.allSettled([
        revokeOwner(ownerContext(database, first), { id: second.id, reason: "Встречный отзыв" }, now),
        revokeOwner(ownerContext(database, second), { id: first.id, reason: "Встречный отзыв" }, now)
      ])

      expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"])
      expect(conflictReason(results)).toMatchObject({
        extensions: { code: "CONFLICT", entity: "owner", expected: "at-least-one", actual: 0 }
      })
      expect(await activeOwners(database)).toHaveLength(1)
      // Отклонённый отзыв не оставляет следа в аудите: его транзакция откатилась целиком.
      const audits = await database.auditLog.findMany({ where: { action: "role.revoke.owner" } })
      expect(audits).toHaveLength(1)
    })
  })

  it("на два встречных закрытия доступа оставляет ровно одного владельца", async () => {
    await withDatabase(async (database) => {
      const first = await createOwner(database, "t133-third@altera.test", "Третий владелец")
      const second = await createOwner(database, "t133-fourth@altera.test", "Четвёртый владелец")

      const results = await Promise.allSettled([
        deactivateOwner(ownerContext(database, first), { id: second.id, reason: "Встречное закрытие" }, now),
        deactivateOwner(ownerContext(database, second), { id: first.id, reason: "Встречное закрытие" }, now)
      ])

      expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"])
      expect(conflictReason(results)).toMatchObject({
        extensions: { code: "CONFLICT", entity: "owner", expected: "at-least-one", actual: 0 }
      })
      expect(await activeOwners(database)).toHaveLength(1)
    })
  })

  // AC-4: сбой второго шага создания не оставляет аккаунт читателя с этим адресом.
  it("после сбоя на аудите не оставляет адрес занятым и даёт создать запись снова", async () => {
    await withDatabase(async (database) => {
      const actor = await createOwner(database, "t133-actor@altera.test", "Владелец")
      const email = "t133-editor@altera.test"

      const broken = ownerContext(database, actor, {
        emailHash: () => {
          throw new Error("pii hasher is down")
        }
      })
      await expect(createStaff(broken, { email, role: "editor", name: "Редактор" }, now)).rejects.toThrow(
        "pii hasher is down"
      )

      expect(await database.user.findUnique({ where: { email } })).toBeNull()
      expect(await database.auditLog.findMany({ where: { action: "user.create.staff" } })).toHaveLength(0)

      const created = await createStaff(ownerContext(database, actor), { email, role: "editor", name: "Редактор" }, now)

      expect(created.role).toBe("editor")
      const stored = await database.user.findUnique({ where: { email } })
      expect(stored).toMatchObject({ role: "editor", isServiceAccount: true })
      expect(await database.auditLog.findMany({ where: { action: "user.create.staff" } })).toHaveLength(1)
    })
  })
})
