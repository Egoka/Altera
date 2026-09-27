import { randomUUID } from "node:crypto"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { startSession, type SessionClient } from "../src/auth/session"
import { hashOpaqueToken } from "../src/auth/token-hash"
import { PrismaClient } from "../src/generated/prisma"
import { applyBaselineMigrations } from "./helpers/migration-database"

/**
 * T-124 AC-2: одна успешная ротация на два параллельных обмена одним refresh-токеном. Это держится
 * на условном `updateMany` по `tokenHash` и на том, что PostgreSQL перепроверяет условие уже после
 * коммита конкурента. Двойник этого не доказывает: в одном процессе Node гонки между чтением
 * строки и её записью нет. Запускается при заданном `T124_TEST_DATABASE_URL`.
 */
const testDatabaseUrl = process.env.T124_TEST_DATABASE_URL
// Все миграции репозитория: имя цели больше любого каталога миграций.
const ALL_MIGRATIONS = "99999999999999_all"

let resolver: typeof import("../src/graphql/auth/resolver").default

beforeAll(async () => {
  vi.stubEnv("JWT_ACCESS_SECRET", "t124-test-access-secret")
  resolver = (await import("../src/graphql/auth/resolver")).default
})

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const withDatabase = async (run: (database: PrismaClient) => Promise<void>): Promise<void> => {
  const name = `t124_${randomUUID().replaceAll("-", "")}`
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

const contextFor = (prisma: PrismaClient) => ({
  prisma,
  requestId: "req-t124",
  logger: { log: vi.fn() },
  requestMeta: { userAgent: "Chrome", ip: "203.0.113.10" },
  currentUser: null as unknown
})

const sessionClient = (prisma: PrismaClient): SessionClient => prisma as unknown as SessionClient

const createReader = async (prisma: PrismaClient, handle: string) => {
  await prisma.handleHistory.create({ data: { handle } })
  const user = await prisma.user.create({ data: { email: `${handle}@example.test`, handle, name: "Читатель" } })
  await prisma.handleHistory.update({ where: { handle }, data: { userId: user.id } })
  return user
}

interface AuthPayload {
  accessToken: string
  refreshToken: string
}

const refresh = (ctx: ReturnType<typeof contextFor>, refreshToken: string): Promise<AuthPayload> =>
  resolver.Mutation.refreshSession!({}, { refreshToken } as never, ctx as never) as Promise<AuthPayload>

describe.skipIf(!testDatabaseUrl)("T-124 ротация refresh на PostgreSQL", () => {
  it("на два параллельных обмена одним токеном оставляет одну ротацию", async () => {
    await withDatabase(async (prisma) => {
      const ctx = contextFor(prisma)
      const user = await createReader(prisma, "t124-parallel")
      const started = await startSession(sessionClient(prisma), user.id, { userAgent: "Chrome", ip: "203.0.113.10" })

      const outcomes = await Promise.allSettled([
        refresh(ctx, started.refreshToken),
        refresh(ctx, started.refreshToken)
      ])

      const fulfilled = outcomes.filter(
        (outcome): outcome is PromiseFulfilledResult<AuthPayload> => outcome.status === "fulfilled"
      )
      expect(fulfilled, "новую пару получает только один обмен").toHaveLength(1)
      const rejected = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult
      expect(rejected.reason).toMatchObject({ extensions: { code: "UNAUTHENTICATED" } })

      // Пара победителя не потеряна поверх пары проигравшего: в строке лежит её хэш, а прежний
      // токен остался в `previousTokenHash` (ADR-0009 п. 3).
      const sessions = await prisma.session.findMany({ where: { userId: user.id } })
      expect(sessions).toHaveLength(1)
      expect(sessions[0]!.tokenHash).toBe(hashOpaqueToken(fulfilled[0]!.value.refreshToken))
      expect(sessions[0]!.previousTokenHash).toBe(hashOpaqueToken(started.refreshToken))
      // Второй обмен предъявил уже ротированный токен: это кража, а не гонка вкладок, поэтому
      // сессии пользователя отозваны (`session-lifecycle.md` §2.4). Вкладки от ложного reuse
      // защищает общий обмен в BFF (AC-3).
      expect(sessions[0]!.revokedAt).not.toBeNull()
    })
  })

  it("последовательный обмен выдаёт новую пару и сохраняет прежний хэш", async () => {
    await withDatabase(async (prisma) => {
      const ctx = contextFor(prisma)
      const user = await createReader(prisma, "t124-sequential")
      const started = await startSession(sessionClient(prisma), user.id, { userAgent: "Chrome", ip: "203.0.113.10" })

      const rotated = await refresh(ctx, started.refreshToken)

      expect(rotated.refreshToken).not.toBe(started.refreshToken)
      const session = await prisma.session.findUniqueOrThrow({ where: { id: started.session.id } })
      expect(session.tokenHash).toBe(hashOpaqueToken(rotated.refreshToken))
      expect(session.previousTokenHash).toBe(hashOpaqueToken(started.refreshToken))
      expect(session.revokedAt).toBeNull()

      // Новый токен работает дальше, прежний — нет.
      const second = await refresh(ctx, rotated.refreshToken)
      expect(second.refreshToken).not.toBe(rotated.refreshToken)
    })
  })

  it("не отвечает unknown обмену по токену отозванной сессии", async () => {
    await withDatabase(async (prisma) => {
      const ctx = contextFor(prisma)
      const user = await createReader(prisma, "t124-revoked")
      const started = await startSession(sessionClient(prisma), user.id, { userAgent: "Chrome", ip: "203.0.113.10" })
      await prisma.session.update({ where: { id: started.session.id }, data: { revokedAt: new Date() } })

      await expect(refresh(ctx, started.refreshToken)).rejects.toMatchObject({
        extensions: { code: "UNAUTHENTICATED" }
      })
      const session = await prisma.session.findUniqueOrThrow({ where: { id: started.session.id } })
      expect(session.tokenHash, "отозванная сессия не ротируется").toBe(hashOpaqueToken(started.refreshToken))
    })
  })
})
