import { createHash, randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { archiveAccount, listAdminUsers, restoreAccount } from "../src/admin/users"
import { createUserWithReservedHandle } from "../src/auth/handle"
import { PrismaClient, type User } from "../src/generated/prisma"
import type { GraphQLContext } from "../src/prisma"
import { applyAllMigrations } from "./helpers/migration-database"

/**
 * T-073 на настоящем PostgreSQL. Двойник проверяет правила раздела, а здесь проверяется то, чего
 * он показать не может: новая колонка категории причины и её тип, атомарность блокировки (архив
 * аккаунта, отзыв сессий и каскад статей — одна транзакция) и семантика фильтров списка, которые
 * целиком выполняются запросом к базе (`plan`, `hasPublications`, поиск от трёх знаков).
 *
 * Запускается при заданном `T073_TEST_DATABASE_URL` (адрес базы `postgres` того же сервера: набор
 * создаёт и удаляет одноразовую базу сам).
 */
const testDatabaseUrl = process.env.T073_TEST_DATABASE_URL

const now = new Date("2026-09-28T12:00:00.000Z")

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const withDatabase = async (run: (database: PrismaClient) => Promise<void>): Promise<void> => {
  const name = `t073_${randomUUID().replaceAll("-", "")}`
  const admin = prismaFor(databaseUrl("postgres"))
  const url = databaseUrl(name)
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    applyAllMigrations(url)
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

const staffContext = (database: PrismaClient, actor: Pick<User, "id" | "role">): GraphQLContext =>
  ({
    currentUser: {
      id: actor.id,
      role: actor.role,
      archivedAt: null,
      planTier: "free",
      planUntil: null,
      permissionExceptions: []
    },
    requestId: "req-t073",
    prisma: database,
    cache: { delByTags: vi.fn().mockResolvedValue(undefined) },
    mail: { send: vi.fn().mockResolvedValue({}) },
    piiHasher: { email: (value: string) => `digest:${value}`, ip: (value: string) => value },
    logger: { log: vi.fn() }
  }) as unknown as GraphQLContext

const createAccount = (
  database: PrismaClient,
  input: { email: string; name: string; role?: "reader" | "author"; isServiceAccount?: boolean }
): Promise<User> =>
  createUserWithReservedHandle(database, {
    email: input.email,
    name: input.name,
    locale: "ru",
    role: input.role ?? "author",
    isServiceAccount: input.isServiceAccount ?? false
  })

const createArticle = (
  database: PrismaClient,
  author: User,
  input: { slug: string; status: "published" | "draft" | "archived" }
) =>
  database.article.create({
    data: {
      title: `T073 ${input.slug}`,
      slug: input.slug,
      body: "T073 тело материала",
      status: input.status,
      authorId: author.id,
      ...(input.status === "published" ? { publishedAt: now, firstPublishedAt: now } : {}),
      ...(input.status === "archived"
        ? { archivedAt: now, archivedByActorId: author.id, archivedByRole: "author" as const, archiveReason: "author" }
        : {})
    },
    select: { id: true, slug: true }
  })

/** `tokenHash` ограничен проверкой `^[0-9a-f]{64}$`: фикстура даёт настоящий sha256-хэш. */
const sessionTokenHash = (seed: string): string => createHash("sha256").update(seed).digest("hex")

const createSession = (database: PrismaClient, user: User, seed: string) =>
  database.session.create({
    data: {
      userId: user.id,
      tokenHash: sessionTokenHash(seed),
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/140.0 Safari/537.36"
    },
    select: { id: true }
  })

describe.skipIf(!testDatabaseUrl)("раздел «Пользователи» на настоящей базе", () => {
  it("блокировка закрывает доступ, отзывает сессии и архивирует статьи одной транзакцией", async () => {
    await withDatabase(async (database) => {
      const staff = await createAccount(database, {
        email: "t073-admin@example.test",
        name: "T073 администратор",
        role: "reader",
        isServiceAccount: true
      })
      await database.user.update({ where: { id: staff.id }, data: { role: "admin" } })
      const target = await createAccount(database, { email: "t073-author@example.test", name: "T073 автор" })
      const published = await createArticle(database, target, { slug: "t073-published", status: "published" })
      const draft = await createArticle(database, target, { slug: "t073-draft", status: "draft" })
      const selfArchived = await createArticle(database, target, { slug: "t073-self", status: "archived" })
      await createSession(database, target, "t073session1")
      await createSession(database, target, "t073session2")

      const card = await archiveAccount(
        staffContext(database, { id: staff.id, role: "admin" }),
        {
          id: target.id,
          reasonCategory: "law_or_rights_violation",
          internalReason: "Жалоба правообладателя подтверждена",
          publicMessage: "Материалы нарушают чужие права"
        },
        now
      )

      expect(card).toMatchObject({
        status: "archived",
        archiveMode: "admin",
        archiveReasonCategory: "law_or_rights_violation",
        archivePublicMessage: "Материалы нарушают чужие права"
      })

      const saved = await database.user.findUniqueOrThrow({ where: { id: target.id } })
      expect(saved.archivedAt).toBeInstanceOf(Date)
      expect(saved.archiveReasonCategory).toBe("law_or_rights_violation")
      expect(saved.archivedByActorId).toBe(staff.id)
      expect(saved.archivedByRole).toBe("admin")

      const cascaded = await database.article.findMany({
        where: { id: { in: [published.id, draft.id] } },
        select: { status: true, archivedByActorId: true, archivedByRole: true, archiveReason: true }
      })
      expect(cascaded).toHaveLength(2)
      for (const article of cascaded) {
        expect(article).toMatchObject({
          status: "archived",
          archivedByActorId: staff.id,
          archivedByRole: "admin",
          archiveReason: "account_archive"
        })
      }
      // Статья, архивированная автором до блокировки, остаётся его архивом: иначе он потерял бы её.
      const untouched = await database.article.findUniqueOrThrow({ where: { id: selfArchived.id } })
      expect(untouched.archivedByRole).toBe("author")

      expect(await database.session.count({ where: { userId: target.id, revokedAt: null } })).toBe(0)

      const archiveAudit = await database.auditLog.findFirstOrThrow({
        where: { action: "user.archive", entityId: target.id }
      })
      expect(archiveAudit.diff).toMatchObject({ mode: "admin", cascadeArticles: 2, sessionsRevoked: 2 })
      expect(await database.auditLog.count({ where: { action: "article.archive" } })).toBe(2)
    })
  }, 120_000)

  it("восстановление снимает архив аккаунта и оставляет статьи в архиве", async () => {
    await withDatabase(async (database) => {
      const staff = await createAccount(database, {
        email: "t073-owner@example.test",
        name: "T073 владелец",
        role: "reader",
        isServiceAccount: true
      })
      await database.user.update({ where: { id: staff.id }, data: { role: "owner" } })
      const target = await createAccount(database, { email: "t073-restore@example.test", name: "T073 восстановление" })
      await createArticle(database, target, { slug: "t073-restore-article", status: "published" })

      const ctx = staffContext(database, { id: staff.id, role: "owner" })
      await archiveAccount(
        ctx,
        { id: target.id, reasonCategory: "spam_and_manipulation", internalReason: "Накрутка" },
        now
      )
      const card = await restoreAccount(ctx, { id: target.id, reason: "Оспаривание принято" }, now)

      expect(card).toMatchObject({ status: "active", archiveMode: null, archiveReasonCategory: null })
      const saved = await database.user.findUniqueOrThrow({ where: { id: target.id } })
      expect(saved.archivedAt).toBeNull()
      expect(saved.archiveReasonCategory).toBeNull()
      expect(saved.archivePublicMessage).toBeNull()
      // Статьи остаются в архиве: автор возвращает их сам (журнал §5.4, §25.7).
      expect(await database.article.count({ where: { authorId: target.id, status: "archived" } })).toBe(1)

      const restoreAudit = await database.auditLog.findFirstOrThrow({
        where: { action: "user.restore", entityId: target.id }
      })
      expect(restoreAudit.diff).toMatchObject({ mode: "admin", articlesLeftArchived: 1 })
    })
  }, 120_000)

  it("фильтры списка отбираются запросом к базе", async () => {
    await withDatabase(async (database) => {
      const staff = await createAccount(database, {
        email: "t073-analyst@example.test",
        name: "T073 аналитик",
        role: "reader",
        isServiceAccount: true
      })
      await database.user.update({ where: { id: staff.id }, data: { role: "analyst" } })

      const withGrant = await createAccount(database, { email: "t073-grant@example.test", name: "T073 выдача" })
      await database.planGrant.create({
        data: {
          userId: withGrant.id,
          tier: "pro",
          startsAt: new Date(now.getTime() - 1000),
          endsAt: new Date(now.getTime() + 86_400_000),
          grantedById: staff.id,
          reason: "T073 административная выдача"
        }
      })
      await database.user.update({
        where: { id: withGrant.id },
        data: { planTier: "pro", planUntil: new Date(now.getTime() + 86_400_000) }
      })
      await createArticle(database, withGrant, { slug: "t073-grant-article", status: "published" })

      const expired = await createAccount(database, { email: "t073-expired@example.test", name: "T073 истёк" })
      await database.planGrant.create({
        data: {
          userId: expired.id,
          tier: "standard",
          startsAt: new Date(now.getTime() - 200_000),
          endsAt: new Date(now.getTime() - 1000),
          grantedById: staff.id,
          reason: "T073 закончившаяся выдача"
        }
      })

      const plain = await createAccount(database, {
        email: "t073-plain@example.test",
        name: "T073 без плана",
        role: "reader"
      })

      const ctx = staffContext(database, { id: staff.id, role: "analyst" })
      const grants = await listAdminUsers(ctx, { filters: { plan: "grant" } }, now)
      const ended = await listAdminUsers(ctx, { filters: { plan: "expired" } }, now)
      const free = await listAdminUsers(ctx, { filters: { plan: "free" } }, now)
      const published = await listAdminUsers(ctx, { filters: { hasPublications: true } }, now)
      const unpublished = await listAdminUsers(ctx, { filters: { hasPublications: false } }, now)
      const byEmail = await listAdminUsers(ctx, { filters: { search: "t073-expired@example.test" } }, now)

      expect(grants.items.map(({ id }) => id)).toEqual([withGrant.id])
      expect(ended.items.map(({ id }) => id)).toEqual([expired.id])
      expect(free.items.map(({ id }) => id)).toEqual([plain.id])
      expect(published.items.map(({ id }) => id)).toEqual([withGrant.id])
      expect(unpublished.items.map(({ id }) => id).sort()).toEqual([expired.id, plain.id].sort())
      expect(byEmail.items.map(({ id }) => id)).toEqual([expired.id])
      // Служебная запись аналитика в разделе не появляется ни под одним фильтром (журнал §25.2).
      expect([...grants.items, ...free.items, ...unpublished.items].some(({ id }) => id === staff.id)).toBe(false)
      // Поиск по адресу — чтение персональных данных, даже когда открыт список (§4, §8).
      expect(
        await database.auditLog.count({
          where: { action: "admin.read.personal", entityId: "digest:t073-expired@example.test" }
        })
      ).toBe(1)
    })
  }, 120_000)
})
