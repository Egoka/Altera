import { describe, expect, it, vi } from "vitest"
import userResolver from "../src/graphql/user/resolver"
import articleResolver from "../src/graphql/article/resolver"

const SUBJECT_USER = {
  id: "user-42",
  name: "Alice",
  email: "alice@example.com",
  role: "author",
  handle: "alice",
  locale: "ru",
  archivedAt: null,
  planTier: "free",
  planUntil: null,
  nameCheckStatus: "ok",
  avatarCheckStatus: "ok",
  socialLinks: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  _count: { articles: 0 }
}

const ADMIN_USER = {
  id: "admin-1",
  role: "admin",
  archivedAt: null,
  planTier: "free",
  planUntil: null
}

function makeCtx(auditCreate: ReturnType<typeof vi.fn>, prismaExtra: Record<string, unknown> = {}) {
  return {
    currentUser: ADMIN_USER,
    requestId: "req-pd-audit",
    logger: { log: vi.fn() },
    piiHasher: { email: (e: string) => `hash-${e}`, ip: (i: string) => `hash-${i}` },
    cache: { delByTags: vi.fn(), get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn(), mode: "noop" },
    prisma: {
      auditLog: { create: auditCreate },
      ...prismaExtra
    }
  }
}

// AC-1: adminUser запрос создаёт запись admin.read.personal в auditLog
describe("adminUser", () => {
  it("создаёт auditLog запись admin.read.personal при чтении карточки", async () => {
    const auditCreate = vi.fn().mockResolvedValue({})
    const ctx = makeCtx(auditCreate, {
      user: { findUnique: vi.fn().mockResolvedValue(SUBJECT_USER) }
    })

    const result = await userResolver.Query.adminUser({}, { id: "user-42" }, ctx as never)

    expect(result).toMatchObject({ id: "user-42", email: "alice@example.com" })
    expect(auditCreate).toHaveBeenCalledOnce()
    const call = auditCreate.mock.calls[0][0]
    expect(call.data.action).toBe("admin.read.personal")
    expect(call.data.actorId).toBe("admin-1")
    expect(call.data.entityId).toBe("user-42")
    expect(call.data.entityType).toBe("user")
    expect(call.data.context).toBe("users")
    expect(call.data.purpose).toBe("admin.user.read")
    expect(call.data.requestId).toBe("req-pd-audit")
  })

  it("не создаёт audit запись если пользователь не найден", async () => {
    const auditCreate = vi.fn()
    const ctx = makeCtx(auditCreate, {
      user: { findUnique: vi.fn().mockResolvedValue(null) }
    })

    const result = await userResolver.Query.adminUser({}, { id: "not-found" }, ctx as never)

    expect(result).toBeNull()
    expect(auditCreate).not.toHaveBeenCalled()
  })

  it("отклоняет запрос без права accounts", async () => {
    const auditCreate = vi.fn()
    const ctx = {
      currentUser: { id: "mod-1", role: "moderator", archivedAt: null, planTier: "free", planUntil: null },
      requestId: "req-no-accounts",
      logger: { log: vi.fn() },
      piiHasher: { email: (e: string) => e, ip: (i: string) => i },
      prisma: { auditLog: { create: auditCreate }, user: { findUnique: vi.fn() } }
    }

    await expect(userResolver.Query.adminUser({}, { id: "user-42" }, ctx as never)).rejects.toThrow()
    expect(auditCreate).not.toHaveBeenCalled()
  })
})

// AC-2: moderator не получает email через Article.author (публичный тип User без email)
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
    const author = (article as any)?.author
    expect(author).toBeDefined()
    expect(author?.email).toBeUndefined()
  })
})

// users list тоже пишет audit-записи
describe("users list — audit", () => {
  it("создаёт auditLog запись для каждого возвращённого пользователя", async () => {
    const auditCreate = vi.fn().mockResolvedValue({})
    const users = [SUBJECT_USER, { ...SUBJECT_USER, id: "user-43", email: "bob@example.com", handle: "bob" }]
    const ctx = makeCtx(auditCreate, {
      user: {
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn().mockResolvedValue(users)
      }
    })

    await userResolver.Query.users(
      {},
      {
        pagination: { page: 1, limit: 10 },
        sort: { field: "createdAt", direction: "DESC" },
        filters: { base: {} }
      },
      ctx as never
    )

    expect(auditCreate).toHaveBeenCalledTimes(2)
    expect(auditCreate.mock.calls[0][0].data.entityId).toBe("user-42")
    expect(auditCreate.mock.calls[1][0].data.entityId).toBe("user-43")
  })
})
