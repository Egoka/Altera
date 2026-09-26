import { randomUUID } from "node:crypto"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { PrismaClient } from "../src/generated/prisma"
import { applyBaselineMigrations } from "./helpers/migration-database"
import { createTestRateLimiter } from "./helpers/rate-limit"

/**
 * T-123 AC-4: одноразовость ссылки входа держится на условном UPDATE отметки `usedAt` и на том,
 * что PostgreSQL сериализует две конкурирующие записи одной строки. Двойник этого не доказывает:
 * в одном процессе Node гонки между чтением и записью нет. Запускается при заданном
 * `T123_TEST_DATABASE_URL`.
 */
const testDatabaseUrl = process.env.T123_TEST_DATABASE_URL
// Все миграции репозитория: имя цели больше любого каталога миграций.
const ALL_MIGRATIONS = "99999999999999_all"

let resolver: typeof import("../src/graphql/auth/resolver").default

beforeAll(async () => {
  vi.stubEnv("JWT_ACCESS_SECRET", "t123-test-access-secret")
  vi.stubEnv("MAGIC_LINK_BASE_URL", "http://127.0.0.1:4173/auth/verify")
  resolver = (await import("../src/graphql/auth/resolver")).default
})

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const withDatabase = async (run: (database: PrismaClient) => Promise<void>): Promise<void> => {
  const name = `t123_${randomUUID().replaceAll("-", "")}`
  const admin = prismaFor(databaseUrl("postgres"))
  const url = databaseUrl(name)
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    applyBaselineMigrations(ALL_MIGRATIONS, url)
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

const contextFor = (prisma: PrismaClient) => {
  const sentMail: string[] = []
  const logger = { log: vi.fn() }
  const ctx = {
    prisma,
    requestId: "req-t123",
    logger,
    rateLimiter: createTestRateLimiter({ logger: logger as never }),
    piiHasher: { email: (value: string) => `hash(${value})` },
    mail: {
      send: vi.fn(async (input: { content: { text: string } }) => {
        sentMail.push(input.content.text)
        return { mailId: "mail-1", messageId: "<id>" }
      })
    },
    currentUser: null as unknown
  }
  return { ctx, sentMail, logger }
}

const loginLink = async (world: ReturnType<typeof contextFor>, email: string): Promise<string> => {
  await resolver.Mutation.requestMagicLink(
    {},
    { email, consentVersion: { termsVersion: null, privacyVersion: null }, locale: "ru" },
    world.ctx as never
  )
  return world.sentMail.at(-1)!.match(/token=([0-9a-f]{64})/)![1]!
}

const exchange = (world: ReturnType<typeof contextFor>, token: string) =>
  resolver.Mutation.verifyMagicLink({}, { token }, world.ctx as never)

describe.skipIf(!testDatabaseUrl)("T-123 одноразовость ссылки входа на PostgreSQL", () => {
  it("два параллельных обмена одного токена создают не больше одной сессии для нового аккаунта", async () => {
    await withDatabase(async (prisma) => {
      const world = contextFor(prisma)
      const email = "fresh@example.test"
      const token = await loginLink(world, email)

      const outcomes = await Promise.allSettled([exchange(world, token), exchange(world, token)])

      const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled")
      expect(fulfilled, "вход завершает только одна попытка").toHaveLength(1)
      const rejected = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult
      expect(rejected.reason).toMatchObject({ extensions: { code: "NOT_FOUND", entity: "magicLink" } })

      const user = await prisma.user.findUniqueOrThrow({ where: { email } })
      const sessions = await prisma.session.findMany({ where: { userId: user.id } })
      expect(sessions).toHaveLength(1)
      const stored = await prisma.magicLinkToken.findUniqueOrThrow({ where: { email } })
      expect(stored.usedAt).not.toBeNull()
    })
  })

  it("два параллельных обмена одного токена создают не больше одной сессии для существующего аккаунта", async () => {
    await withDatabase(async (prisma) => {
      const world = contextFor(prisma)
      const email = "reader@example.test"
      await prisma.handleHistory.create({ data: { handle: "t123-reader" } })
      const user = await prisma.user.create({ data: { email, handle: "t123-reader", name: "reader" } })
      await prisma.handleHistory.update({ where: { handle: "t123-reader" }, data: { userId: user.id } })

      const token = await loginLink(world, email)
      const outcomes = await Promise.allSettled([exchange(world, token), exchange(world, token)])

      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1)
      const sessions = await prisma.session.findMany({ where: { userId: user.id } })
      expect(sessions).toHaveLength(1)
      expect(sessions[0]!.limited).toBe(false)
    })
  })

  it("самостоятельно архивированный аккаунт получает одну ограниченную сессию на два обмена", async () => {
    await withDatabase(async (prisma) => {
      const world = contextFor(prisma)
      const email = "archived@example.test"
      await prisma.handleHistory.create({ data: { handle: "t123-archived" } })
      const user = await prisma.user.create({
        data: {
          email,
          handle: "t123-archived",
          name: "archived",
          archivedAt: new Date("2026-09-01T00:00:00.000Z"),
          archiveMode: "self"
        }
      })
      await prisma.handleHistory.update({ where: { handle: "t123-archived" }, data: { userId: user.id } })

      const token = await loginLink(world, email)
      const outcomes = await Promise.allSettled([exchange(world, token), exchange(world, token)])

      const fulfilled = outcomes.filter(
        (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof exchange>>> =>
          outcome.status === "fulfilled"
      )
      expect(fulfilled).toHaveLength(1)
      expect(fulfilled[0]!.value.outcome).toBe("archived_self")
      const sessions = await prisma.session.findMany({ where: { userId: user.id } })
      expect(sessions).toHaveLength(1)
      expect(sessions[0]!.limited).toBe(true)
    })
  })
})
