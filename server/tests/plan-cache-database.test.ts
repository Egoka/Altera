import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { GraphQLError } from "graphql"
import { PrismaClient } from "../src/generated/prisma"
import { grantPlan, listAdminGrants, revokePlan } from "../src/admin/grants"
import { enableBaseAuthorship, BASE_AUTHORSHIP_REASON } from "../src/authorship/base-authorship"
import authorResolver from "../src/graphql/author/resolver"
import type { Cache, CacheSetOptions } from "../src/cache"
import type { GraphQLContext } from "../src/prisma"
import { applyBaselineMigrations } from "./helpers/migration-database"

/**
 * T-128 на настоящем PostgreSQL: кэш плана (`users.role`, `planTier`, `planUntil`) считается по
 * выдачам в той же транзакции, что и сама выдача (`role-derivation.md` §2 п. 1–3). Двойник этого
 * не докажет — проверяется именно состояние строк после коммита и то, что бейдж публичной
 * страницы читает записанный кэш, а не подставленное значение.
 *
 * Запускается при заданном `T128_TEST_DATABASE_URL`.
 */
const testDatabaseUrl = process.env.T128_TEST_DATABASE_URL
// Имя старше любого каталога миграций: применяются все миграции по порядку.
const afterAllMigrations = "99999999999999_after_all"

const NOW = new Date("2026-09-20T12:00:00.000Z")
const SOON = new Date("2026-10-20T00:00:00.000Z")
const LATER = new Date("2026-12-20T00:00:00.000Z")
const AFTER_SOON = new Date("2026-11-01T00:00:00.000Z")
const FAR_FUTURE = new Date("2099-01-01T00:00:00.000Z")
const EXPIRED_FROM = new Date("2020-01-01T00:00:00.000Z")
const EXPIRED_TO = new Date("2020-02-01T00:00:00.000Z")

const iso = (value: Date): string => value.toISOString()

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const withDatabase = async (run: (database: PrismaClient) => Promise<void>): Promise<void> => {
  const name = `t128_${randomUUID().replaceAll("-", "")}`
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

class NoopCache implements Cache {
  readonly mode = "noop" as const
  async isReady(): Promise<boolean> {
    return true
  }
  async get<T>(): Promise<T | null> {
    return null
  }
  async set<T>(_key: string, _value: T, _options: CacheSetOptions): Promise<void> {
    void _key
    void _value
    void _options
  }
  async del(): Promise<void> {}
  async delByTags(): Promise<void> {}
  async close(): Promise<void> {}
}

const seedUser = async (
  db: PrismaClient,
  user: { handle: string; role: "reader" | "author" | "admin"; service?: boolean }
): Promise<{ id: string; role: string; handle: string; archivedAt: null; isServiceAccount: boolean }> => {
  await db.handleHistory.create({ data: { handle: user.handle } })
  const row = await db.user.create({
    data: {
      email: `${user.handle}@example.test`,
      name: user.handle,
      handle: user.handle,
      role: user.role,
      isServiceAccount: user.service ?? false
    }
  })
  return { id: row.id, role: row.role, handle: row.handle, archivedAt: null, isServiceAccount: row.isServiceAccount }
}

/** Контекст запроса от лица сотрудника: раздел грантов читает только `prisma` и `currentUser`. */
const ctxFor = (db: PrismaClient, currentUser: unknown): GraphQLContext =>
  ({
    prisma: db,
    currentUser,
    requestId: `req-${randomUUID()}`,
    cache: new NoopCache(),
    // Публичный профиль собирает адрес аватара из вариантов записи медиа (T-065).
    media: { mediaBaseUrl: "https://media.altera.test" }
  }) as unknown as GraphQLContext

const planCache = async (db: PrismaClient, id: string) =>
  db.user.findUniqueOrThrow({ where: { id }, select: { role: true, planTier: true, planUntil: true } })

/** Опубликованный материал: без него публичной страницы автора нет (`author.md` §1). */
const publish = async (db: PrismaClient, authorId: string, slug: string): Promise<void> => {
  await db.article.create({
    data: {
      title: `Материал ${slug}`,
      slug,
      body: "Текст",
      status: "published",
      publishedAt: NOW,
      firstPublishedAt: NOW,
      authorId
    }
  })
}

const manualGrant = (userHandle: string, tier: "standard" | "pro", endsAt: Date) => ({
  userHandle,
  tier,
  startsAt: iso(NOW),
  endsAt: iso(endsAt),
  reason: `Выдача ${tier}`
})

describe.skipIf(!testDatabaseUrl)("T-128 кэш плана на PostgreSQL", () => {
  it("AC-1: выдача поднимает читателя до автора и открывает создание статьи", async () => {
    await withDatabase(async (db) => {
      const admin = await seedUser(db, { handle: "admin-1", role: "admin", service: true })
      const reader = await seedUser(db, { handle: "reader-1", role: "reader" })

      await grantPlan(ctxFor(db, admin), manualGrant("reader-1", "standard", SOON), NOW)

      expect(await planCache(db, reader.id)).toEqual({ role: "author", planTier: "standard", planUntil: SOON })

      // Создание статьи идёт по записанному кэшу: второй выдачи и события `author.enabled` нет.
      const actor = await enableBaseAuthorship(
        { prisma: db, currentUser: { ...reader, ...(await planCache(db, reader.id)), locale: "ru" }, requestId: "req" },
        "article.create",
        NOW
      )

      expect(actor.role).toBe("author")
      expect(await db.planGrant.count({ where: { userId: reader.id } })).toBe(1)
      expect(await db.auditLog.count({ where: { action: "author.enabled" } })).toBe(0)
    })
  })

  it("AC-2: отзыв срочной выдачи приводит кэш к оставшимся выдачам", async () => {
    await withDatabase(async (db) => {
      const admin = await seedUser(db, { handle: "admin-1", role: "admin", service: true })
      const reader = await seedUser(db, { handle: "reader-1", role: "reader" })
      const ctx = ctxFor(db, admin)

      const standard = await grantPlan(ctx, manualGrant("reader-1", "standard", LATER), NOW)
      // Приоритетный `pro` действует раньше оставшегося `standard` (журнал §8.22).
      const pro = await grantPlan(ctx, manualGrant("reader-1", "pro", SOON), NOW)
      expect(await planCache(db, reader.id)).toEqual({ role: "author", planTier: "pro", planUntil: SOON })

      await revokePlan(ctx, { grantId: pro.id, reason: "Ошибка выдачи" }, NOW)
      expect(await planCache(db, reader.id)).toEqual({ role: "author", planTier: "standard", planUntil: LATER })

      await revokePlan(ctx, { grantId: standard.id, reason: "Решение редакции" }, NOW)
      expect(await planCache(db, reader.id)).toEqual({ role: "reader", planTier: "free", planUntil: null })
    })
  })

  it("AC-2: истёкшая выдача в кэш не возвращается", async () => {
    await withDatabase(async (db) => {
      const admin = await seedUser(db, { handle: "admin-1", role: "admin", service: true })
      const reader = await seedUser(db, { handle: "reader-1", role: "reader" })
      const ctx = ctxFor(db, admin)

      await grantPlan(ctx, manualGrant("reader-1", "pro", SOON), NOW)
      // Пересчёт идёт на «сейчас» записи: после окончания срока приоритетного `pro` действует
      // только вторая выдача, хотя `pro` остаётся в таблице неотозванным.
      const standard = await grantPlan(ctx, manualGrant("reader-1", "standard", LATER), AFTER_SOON)
      expect(await planCache(db, reader.id)).toEqual({ role: "author", planTier: "standard", planUntil: LATER })

      // Отзыв единственной действующей выдачи истёкший `pro` не оживляет.
      await revokePlan(ctx, { grantId: standard.id, reason: "Уборка" }, AFTER_SOON)
      expect(await planCache(db, reader.id)).toEqual({ role: "reader", planTier: "free", planUntil: null })

      // Отзыв уже истёкшей выдачи остаётся конфликтом состояния, а не тихим успехом.
      const expired = await db.planGrant.findFirstOrThrow({ where: { tier: "pro" } })
      await expect(revokePlan(ctx, { grantId: expired.id, reason: "Уборка" }, AFTER_SOON)).rejects.toMatchObject<
        Partial<GraphQLError>
      >({ extensions: { code: "CONFLICT", actual: "ended" } })
    })
  })

  it("AC-3: истёкшая админская выдача базовому авторству не мешает", async () => {
    await withDatabase(async (db) => {
      const admin = await seedUser(db, { handle: "admin-1", role: "admin", service: true })
      const reader = await seedUser(db, { handle: "reader-1", role: "reader" })

      await grantPlan(ctxFor(db, admin), manualGrant("reader-1", "standard", SOON), NOW)
      expect(await planCache(db, reader.id)).toEqual({ role: "author", planTier: "standard", planUntil: SOON })

      // Срок вышел: первое «Создать статью» после него открывает базовое авторство бессрочно
      // (журнал §24.1, §25.1) — `plan-free.md` п. 3 действует только после включения платности.
      const actor = await enableBaseAuthorship(
        { prisma: db, currentUser: { ...reader, ...(await planCache(db, reader.id)), locale: "ru" }, requestId: "req" },
        "article.create",
        AFTER_SOON
      )

      expect(actor).toMatchObject({ role: "author", planTier: "standard", planUntil: null })
      expect(await planCache(db, reader.id)).toEqual({ role: "author", planTier: "standard", planUntil: null })
      expect(await db.planGrant.count({ where: { userId: reader.id, reason: BASE_AUTHORSHIP_REASON } })).toBe(1)
      expect(await db.auditLog.count({ where: { action: "author.enabled", actorId: reader.id } })).toBe(1)
    })
  })

  it("AC-4: базовая выдача не попадает в раздел грантов и не отзывается", async () => {
    await withDatabase(async (db) => {
      const admin = await seedUser(db, { handle: "admin-1", role: "admin", service: true })
      const reader = await seedUser(db, { handle: "reader-1", role: "reader" })
      const ctx = ctxFor(db, admin)

      await enableBaseAuthorship(
        { prisma: db, currentUser: { ...reader, planTier: "free", planUntil: null }, requestId: "req" },
        "article.create",
        NOW
      )
      const manual = await grantPlan(ctx, manualGrant("reader-1", "pro", LATER), NOW)
      const base = await db.planGrant.findFirstOrThrow({ where: { reason: BASE_AUTHORSHIP_REASON } })

      expect((await listAdminGrants(ctx, NOW)).map((row) => row.id)).toEqual([manual.id])

      await expect(revokePlan(ctx, { grantId: base.id, reason: "Отзыв" }, NOW)).rejects.toMatchObject<
        Partial<GraphQLError>
      >({ extensions: { code: "FORBIDDEN", action: "plan.revoke" } })

      expect(await db.planGrant.findUniqueOrThrow({ where: { id: base.id } })).toMatchObject({ revokedAt: null })
      // Отзыв ручной выдачи базовое авторство не закрывает: остаётся бессрочный `standard`.
      await revokePlan(ctx, { grantId: manual.id, reason: "Решение редакции" }, NOW)
      expect(await planCache(db, reader.id)).toEqual({ role: "author", planTier: "standard", planUntil: null })
    })
  })

  /**
   * AC-5. Страница автора читается настоящим резолвером на настоящем «сейчас», поэтому срок
   * задаётся самой выдачей: действующая — с концом в далёком будущем, истёкшая — с окном,
   * закрытым в прошлом. `planTier` в тесте нигде не подставляется: его пишет только `grantPlan`.
   */
  it("AC-5: действующая выдача pro показывает бейдж на странице автора", async () => {
    await withDatabase(async (db) => {
      const admin = await seedUser(db, { handle: "admin-1", role: "admin", service: true })
      const author = await seedUser(db, { handle: "vera", role: "reader" })
      await publish(db, author.id, "material")

      const grant = await grantPlan(ctxFor(db, admin), manualGrant("vera", "pro", FAR_FUTURE), new Date())
      expect(await planCache(db, author.id)).toMatchObject({ role: "author", planTier: "pro" })

      expect((await authorResolver.Query.author({}, { handle: "vera" }, ctxFor(db, null))).grade).toBe("pro")

      // Отзыв снимает бейдж в том же коммите, что и запись кэша.
      await revokePlan(ctxFor(db, admin), { grantId: grant.id, reason: "Отзыв" }, new Date())
      expect((await authorResolver.Query.author({}, { handle: "vera" }, ctxFor(db, null))).grade).toBe("standard")
    })
  })

  it("AC-5: истёкшая выдача pro бейдж на странице автора снимает", async () => {
    await withDatabase(async (db) => {
      const admin = await seedUser(db, { handle: "admin-1", role: "admin", service: true })
      const author = await seedUser(db, { handle: "vera", role: "reader" })
      await publish(db, author.id, "material")

      // Выдача действовала в прошлом: кэш получил `pro` со своим сроком, срок уже вышел.
      await grantPlan(
        ctxFor(db, admin),
        { userHandle: "vera", tier: "pro", startsAt: iso(EXPIRED_FROM), endsAt: iso(EXPIRED_TO), reason: "Выдача pro" },
        new Date(EXPIRED_FROM.getTime() + 24 * 60 * 60 * 1000)
      )
      expect(await planCache(db, author.id)).toEqual({ role: "author", planTier: "pro", planUntil: EXPIRED_TO })

      expect((await authorResolver.Query.author({}, { handle: "vera" }, ctxFor(db, null))).grade).toBe("standard")
    })
  })
})
