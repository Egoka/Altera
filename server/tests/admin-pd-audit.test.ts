import { describe, expect, it, vi } from "vitest"
import articleResolver from "../src/graphql/article/resolver"
import { getAdminUser, listAdminUsers } from "../src/admin/users"
import { adminUsersContext, auditsOf, MemoryPrisma, memoryUser } from "./helpers/admin-users-double"

/**
 * Чтение персональных данных административным инструментом (матрица #104, журнал #6, §14.4, §28.7).
 *
 * AC-1: карточка пользователя раскрывает адрес и записывает `admin.read.personal`; список с
 * маской такой записи не делает — иначе журнал захламляется просмотром без раскрытия ПДн
 * (`40-admin/users.md` §8). AC-2: публичный тип `User` в `Article.author` адреса не содержит,
 * поэтому модератор его не получает и в обход карточки.
 */

const now = new Date("2026-09-28T12:00:00.000Z")

const subject = memoryUser({
  id: "user-42",
  role: "author",
  handle: "alice",
  name: "Alice",
  email: "alice@example.com"
})

const admin = memoryUser({ id: "admin-1", role: "admin", isServiceAccount: true, handle: "staff-admin" })
const moderator = memoryUser({ id: "mod-1", role: "moderator", isServiceAccount: true, handle: "staff-moderator" })

describe("adminUser", () => {
  it("создаёт auditLog запись admin.read.personal при чтении карточки", async () => {
    const prisma = new MemoryPrisma({ users: [subject, admin] })
    const ctx = adminUsersContext(prisma, admin)

    const result = await getAdminUser(ctx, "user-42", now)

    expect(result).toMatchObject({ id: "user-42", email: "alice@example.com", emailMasked: false })
    const records = auditsOf(prisma, "admin.read.personal")
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      action: "admin.read.personal",
      actorId: "admin-1",
      actorRole: "admin",
      entityType: "user",
      entityId: "user-42",
      context: "admin.users",
      purpose: "admin.user.read",
      requestId: "req-admin-users"
    })
  })

  it("не создаёт audit запись если пользователь не найден", async () => {
    const prisma = new MemoryPrisma({ users: [admin] })

    const result = await getAdminUser(adminUsersContext(prisma, admin), "not-found", now)

    expect(result).toBeNull()
    expect(auditsOf(prisma, "admin.read.personal")).toHaveLength(0)
  })

  it("отклоняет запрос роли без доступа к разделу", async () => {
    const prisma = new MemoryPrisma({ users: [subject, moderator] })

    await expect(getAdminUser(adminUsersContext(prisma, moderator), "user-42", now)).rejects.toThrow()
    expect(auditsOf(prisma, "admin.read.personal")).toHaveLength(0)
  })
})

describe("список пользователей — аудит", () => {
  it("не пишет чтение ПДн на строки списка: адрес идёт маской", async () => {
    const prisma = new MemoryPrisma({
      users: [subject, memoryUser({ id: "user-43", handle: "bob", email: "bob@example.com" }), admin]
    })

    const list = await listAdminUsers(adminUsersContext(prisma, admin), {}, now)

    expect(list.items.map(({ email }) => email)).toEqual(["b***b@example.com", "a***e@example.com"])
    expect(auditsOf(prisma, "admin.read.personal")).toHaveLength(0)
  })
})

describe("публичный тип User не содержит email в Article.author", () => {
  it("article resolver не возвращает email в поле author", async () => {
    const auditCreate = vi.fn()
    const ctx = {
      currentUser: { id: "mod-1", role: "moderator", archivedAt: null, planTier: "free", planUntil: null },
      requestId: "req-mod-article",
      logger: { log: vi.fn() },
      piiHasher: { email: (e: string) => `hash-${e}`, ip: (i: string) => `hash-${i}` },
      cache: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn(), delByTags: vi.fn(), mode: "noop" },
      prisma: {
        auditLog: { create: auditCreate },
        article: {
          findUnique: vi.fn().mockResolvedValue({
            id: "art-1",
            slug: "test-article",
            title: "Test",
            status: "published",
            authorId: "user-42",
            author: { id: "user-42", name: "Alice", handle: "alice", createdAt: new Date(), updatedAt: new Date() }
          })
        }
      }
    }

    const article = await articleResolver.Query.article({}, { slug: "test-article" }, ctx as never)

    expect(article).toBeDefined()
    // Поле author — публичный тип User, не AccountUser: email не включён в ответ
    const author = (article as { author?: { email?: string } } | null)?.author
    expect(author).toBeDefined()
    expect(author?.email).toBeUndefined()
  })
})
