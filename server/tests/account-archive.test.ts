import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { hashOpaqueToken } from "../src/auth/token-hash"
import { createTestRateLimiter } from "./helpers/rate-limit"

/**
 * Самостоятельное архивирование аккаунта и экран состояния (T-035, журнал §5.1–2, §25.7;
 * `30-account/reader/delete-account.md`, `archived-state.md`).
 *
 * Главная проверка задачи — AC-1: после восстановления аккаунта статьи остаются в архиве.
 * Поэтому двойник хранит статьи и сессии отдельно, а тесты сверяют их состояние после каждой
 * ветки: архив трогает статьи один раз, восстановление — ни разу.
 */

const ACCESS_SECRET = "t035-test-access-secret"
const NOW = new Date("2026-09-27T10:00:00.000Z")

type FakeRole = "reader" | "author" | "admin" | "owner"
type FakeArchiveMode = "self" | "admin" | "emergency"
type FakeArticleStatus = "draft" | "review" | "published" | "archived"

interface FakeUser {
  id: string
  email: string
  role: FakeRole
  locale: "ru" | "en"
  archivedAt: Date | null
  archiveMode: FakeArchiveMode | null
  archivedByActorId: string | null
  archivedByRole: FakeRole | null
  archiveReason: string | null
  isServiceAccount: boolean
}

interface FakeArticle {
  id: string
  authorId: string
  status: FakeArticleStatus
  archivedAt: Date | null
  archivedByActorId: string | null
  archivedByRole: FakeRole | null
  archiveReason: string | null
}

interface FakeSession {
  id: string
  userId: string
  tokenHash: string
  revokedAt: Date | null
  limited: boolean
}

interface FakeRequest {
  userId: string
  tokenHash: string
  expiresAt: Date
  createdAt: Date
}

const account = (overrides: Partial<FakeUser> = {}): FakeUser => ({
  id: "user-1",
  email: "author@example.test",
  role: "author",
  locale: "ru",
  archivedAt: null,
  archiveMode: null,
  archivedByActorId: null,
  archivedByRole: null,
  archiveReason: null,
  isServiceAccount: false,
  ...overrides
})

const article = (id: string, status: FakeArticleStatus): FakeArticle => ({
  id,
  authorId: "user-1",
  status,
  archivedAt: status === "archived" ? NOW : null,
  archivedByActorId: status === "archived" ? "user-1" : null,
  archivedByRole: status === "archived" ? "author" : null,
  archiveReason: status === "archived" ? "author" : null
})

interface WorldOptions {
  users?: FakeUser[]
  currentUser?: FakeUser | null
  articles?: FakeArticle[]
  sessions?: FakeSession[]
  request?: FakeRequest | null
  grants?: { tier: "free" | "standard" | "pro"; startsAt: Date; endsAt: Date | null; revokedAt: Date | null }[]
  now?: Date
}

const matchesStatus = (value: FakeArticleStatus, filter: unknown): boolean => {
  if (filter === undefined) return true
  if (typeof filter === "string") return value === filter
  const not = (filter as { not?: string }).not
  return not === undefined ? true : value !== not
}

function createWorld(options: WorldOptions = {}) {
  const current = options.currentUser === undefined ? account() : options.currentUser
  const users = [...(options.users ?? (current ? [current] : []))]
  const articles = [...(options.articles ?? [])]
  const sessions = [
    ...(options.sessions ?? [
      { id: "session-limited", userId: "user-1", tokenHash: "hash-1", revokedAt: null, limited: true }
    ])
  ]
  const grants = [...(options.grants ?? [])]
  const audit: Record<string, unknown>[] = []
  const sentMail: { to: string; template: string; text: string; sanitizedBody: string }[] = []
  let request: FakeRequest | null = options.request ?? null
  let createdSessions = 0

  const byUser = (where: { userId?: string }) => (row: { userId: string }) =>
    where.userId === undefined || row.userId === where.userId

  const prisma = {
    accountArchiveRequest: {
      findUnique: vi.fn(async ({ where }: { where: { userId?: string; tokenHash?: string } }) => {
        if (!request) return null
        if (where.userId !== undefined) return request.userId === where.userId ? { id: "request-1", ...request } : null
        return request.tokenHash === where.tokenHash ? { id: "request-1", ...request } : null
      }),
      upsert: vi.fn(async ({ where, update, create }: { where: { userId: string }; update: any; create: any }) => {
        request = request && request.userId === where.userId ? { ...request, ...update } : { ...create }
        return { id: "request-1", ...request }
      }),
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const removed = request && request.userId === where.userId ? 1 : 0
        if (removed) request = null
        return { count: removed }
      })
    },
    user: {
      count: vi.fn(
        async ({ where }: { where: { role?: FakeRole; archivedAt?: null } }) =>
          users.filter(
            (user) =>
              (where.role === undefined || user.role === where.role) &&
              (where.archivedAt === undefined || user.archivedAt === null)
          ).length
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) => {
        const found = users.find((user) => user.id === where.id)
        if (!found) throw new Error(`Unknown user ${where.id}`)
        Object.assign(found, data)
        return found
      })
    },
    article: {
      count: vi.fn(
        async ({ where }: { where: { authorId: string; status?: unknown } }) =>
          articles.filter((row) => row.authorId === where.authorId && matchesStatus(row.status, where.status)).length
      ),
      findMany: vi.fn(async ({ where }: { where: { authorId: string; status?: unknown } }) =>
        articles
          .filter((row) => row.authorId === where.authorId && matchesStatus(row.status, where.status))
          .map(({ id, status }) => ({ id, status }))
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: { authorId: string; status?: unknown }; data: Partial<FakeArticle> }) => {
          let count = 0
          for (const row of articles) {
            if (row.authorId !== where.authorId || !matchesStatus(row.status, where.status)) continue
            Object.assign(row, data)
            count += 1
          }
          return { count }
        }
      )
    },
    session: {
      create: vi.fn(async ({ data }: { data: { userId: string; tokenHash: string; limited?: boolean } }) => {
        createdSessions += 1
        const row: FakeSession = {
          id: `session-new-${createdSessions}`,
          userId: data.userId,
          tokenHash: data.tokenHash,
          revokedAt: null,
          limited: data.limited ?? false
        }
        sessions.push(row)
        return row
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: { userId?: string; revokedAt: null }; data: { revokedAt: Date } }) => {
          let count = 0
          for (const row of sessions.filter(byUser(where))) {
            if (row.revokedAt !== null) continue
            row.revokedAt = data.revokedAt
            count += 1
          }
          return { count }
        }
      )
    },
    planGrant: {
      findMany: vi.fn(async () => grants)
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        audit.push(data)
        return data
      }),
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        audit.push(...data)
        return { count: data.length }
      })
    },
    $transaction: vi.fn(async (run: (client: unknown) => unknown) => run(prisma))
  }

  const ctx = {
    prisma,
    currentUser: current,
    requestId: "req-t035",
    requestMeta: { ip: "203.0.113.7", userAgent: "vitest" },
    logger: { log: () => undefined },
    rateLimiter: createTestRateLimiter({ now: () => options.now ?? NOW }),
    mail: {
      send: vi.fn(async (input: any) => {
        sentMail.push({
          to: input.to,
          template: input.template,
          text: input.content.text,
          sanitizedBody: input.sanitizedBody
        })
        return { mailId: "mail-1", messageId: "message-1" }
      })
    }
  }

  return { ctx, prisma, users, articles, sessions, audit, sentMail, currentRequest: () => request }
}

interface ArchiveResolver {
  AccountUser: {
    archivePreview(parent: { id: string }, args: unknown, ctx: unknown): Promise<any>
    archiveState(parent: { id: string }, args: unknown, ctx: unknown): Promise<any>
  }
  Mutation: {
    requestAccountArchive(parent: unknown, args: { mode: FakeArchiveMode }, ctx: unknown): Promise<any>
    cancelAccountArchive(parent: unknown, args: unknown, ctx: unknown): Promise<any>
    confirmAccountArchive(parent: unknown, args: { token: string }, ctx: unknown): Promise<any>
    restoreAccountSelf(parent: unknown, args: unknown, ctx: unknown): Promise<any>
  }
}

let resolver: ArchiveResolver

beforeAll(async () => {
  vi.stubEnv("JWT_ACCESS_SECRET", ACCESS_SECRET)
  vi.stubEnv("FRONTEND_URL", "https://altera.test")
  resolver = (await import("../src/graphql/account-archive/resolver")).default as never
})

beforeEach(() => {
  vi.useRealTimers()
})

const tokenFromMail = (text: string): string => {
  const token = text.match(/\/me\/delete\/confirm\?token=([0-9a-f]{64})/)?.[1]
  if (!token) throw new Error("Confirmation link is missing from the letter")
  return token
}

describe("страница «Удалить аккаунт»", () => {
  it("показывает число материалов, план и отсутствие открытого запроса", async () => {
    const world = createWorld({
      articles: [article("article-1", "published"), article("article-2", "draft"), article("article-3", "archived")],
      grants: [{ tier: "standard", startsAt: new Date("2026-09-01T00:00:00.000Z"), endsAt: null, revokedAt: null }]
    })

    const preview = await resolver.AccountUser.archivePreview({ id: "user-1" }, {}, world.ctx)

    // Архивированная статья уже в архиве: каскад её не тронет и в предупреждении она не считается.
    expect(preview.articlesCount).toBe(2)
    expect(preview.plan).toMatchObject({ state: "base", tier: "standard" })
    expect(preview.isLastOwner).toBe(false)
    expect(preview.pending).toBeNull()
  })

  it("отказывает в чтении чужой записи", async () => {
    const world = createWorld()

    await expect(resolver.AccountUser.archivePreview({ id: "user-2" }, {}, world.ctx)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" }
    })
  })

  it("уводит архивированную запись с формы: её место — экран состояния", async () => {
    const world = createWorld({ currentUser: account({ archivedAt: NOW, archiveMode: "self" }) })

    await expect(resolver.AccountUser.archivePreview({ id: "user-1" }, {}, world.ctx)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN", action: "account.archive.self" }
    })
  })
})

describe("запрос письма", () => {
  it("отправляет ссылку подтверждения и показывает открытый запрос", async () => {
    const world = createWorld({ articles: [article("article-1", "published")] })

    const preview = await resolver.Mutation.requestAccountArchive(null, { mode: "self" }, world.ctx)

    expect(world.sentMail).toHaveLength(1)
    expect(world.sentMail[0]!.to).toBe("author@example.test")
    expect(world.sentMail[0]!.template).toBe("account_archive_confirm")
    expect(world.sentMail[0]!.text).toContain("https://altera.test/me/delete/confirm?token=")
    // Копия письма в истории не несёт секрета (§27.6): ссылка в ней заменена пометкой.
    expect(world.sentMail[0]!.sanitizedBody).not.toContain("/me/delete/confirm?token=")
    expect(preview.pending).not.toBeNull()
    // В базе лежит только хэш ссылки.
    expect(world.currentRequest()!.tokenHash).toBe(hashOpaqueToken(tokenFromMail(world.sentMail[0]!.text)))
  })

  it("отвечает CONFLICT последнему владельцу и письма не шлёт", async () => {
    const owner = account({ role: "owner" })
    const world = createWorld({ currentUser: owner, users: [owner] })

    await expect(resolver.Mutation.requestAccountArchive(null, { mode: "self" }, world.ctx)).rejects.toMatchObject({
      extensions: { code: "CONFLICT", actual: "last owner" }
    })
    expect(world.sentMail).toHaveLength(0)
  })

  it("пропускает владельца, если он не последний", async () => {
    const owner = account({ role: "owner" })
    const second = account({ id: "user-2", email: "second@example.test", role: "owner" })
    const world = createWorld({ currentUser: owner, users: [owner, second] })

    await expect(resolver.Mutation.requestAccountArchive(null, { mode: "self" }, world.ctx)).resolves.toMatchObject({
      isLastOwner: false
    })
  })

  it("отвечает CONFLICT, пока открыт прежний запрос", async () => {
    const world = createWorld({
      request: {
        userId: "user-1",
        tokenHash: hashOpaqueToken("open-token"),
        expiresAt: new Date(NOW.getTime() + 30 * 60_000),
        createdAt: NOW
      },
      now: NOW
    })
    vi.setSystemTime(NOW)

    await expect(resolver.Mutation.requestAccountArchive(null, { mode: "self" }, world.ctx)).rejects.toMatchObject({
      extensions: { code: "CONFLICT", entity: "accountArchive" }
    })
  })

  it("держит лимит «1 запрос в сутки» (`rate-limits.md` §2 п. 8)", async () => {
    const world = createWorld({ now: NOW })

    await resolver.Mutation.requestAccountArchive(null, { mode: "self" }, world.ctx)
    await resolver.Mutation.cancelAccountArchive(null, {}, world.ctx)

    await expect(resolver.Mutation.requestAccountArchive(null, { mode: "self" }, world.ctx)).rejects.toMatchObject({
      extensions: { code: "RATE_LIMITED" }
    })
  })

  it("не принимает административный режим: он выполняется не отсюда", async () => {
    const world = createWorld()

    await expect(resolver.Mutation.requestAccountArchive(null, { mode: "admin" }, world.ctx)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" }
    })
  })

  it("отмена закрывает запрос", async () => {
    const world = createWorld()
    await resolver.Mutation.requestAccountArchive(null, { mode: "self" }, world.ctx)

    const preview = await resolver.Mutation.cancelAccountArchive(null, {}, world.ctx)

    expect(preview.pending).toBeNull()
    expect(world.currentRequest()).toBeNull()
  })
})

describe("подтверждение архива", () => {
  const archived = async () => {
    const world = createWorld({
      articles: [article("article-1", "published"), article("article-2", "draft"), article("article-3", "archived")],
      sessions: [
        { id: "session-desktop", userId: "user-1", tokenHash: "hash-1", revokedAt: null, limited: false },
        { id: "session-phone", userId: "user-1", tokenHash: "hash-2", revokedAt: null, limited: false }
      ]
    })
    await resolver.Mutation.requestAccountArchive(null, { mode: "self" }, world.ctx)
    const token = tokenFromMail(world.sentMail[0]!.text)
    const result = await resolver.Mutation.confirmAccountArchive(null, { token }, world.ctx)
    return { world, result }
  }

  it("архивирует аккаунт, статьи и сессии одной транзакцией", async () => {
    const { world, result } = await archived()

    expect(result).toMatchObject({ archived: true, articlesArchived: 2 })
    expect(world.users[0]).toMatchObject({ archiveMode: "self", archiveReason: "self", archivedByActorId: "user-1" })
    expect(world.users[0]!.archivedAt).not.toBeNull()
    expect(world.articles.every((row) => row.status === "archived")).toBe(true)
    expect(world.sessions.every((row) => row.revokedAt !== null)).toBe(true)
    expect(world.currentRequest()).toBeNull()
    expect(world.prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it("оставляет каскадные статьи на самом авторе, чтобы он мог вернуть их потом", async () => {
    const { world } = await archived()

    const cascaded = world.articles.filter((row) => row.archiveReason === "account_archive")
    expect(cascaded).toHaveLength(2)
    expect(cascaded.every((row) => row.archivedByActorId === "user-1" && row.archivedByRole === "author")).toBe(true)
  })

  it("пишет аудит `user.archive.self` и каскадный `article.archive`", async () => {
    const { world } = await archived()

    expect(world.audit.filter((entry) => entry.action === "article.archive")).toHaveLength(2)
    const record = world.audit.find((entry) => entry.action === "user.archive.self")
    expect(record).toMatchObject({ actorId: "user-1", entityType: "user", entityId: "user-1" })
    expect(record!.diff).toMatchObject({ mode: "self", articlesArchived: 2, sessionsRevoked: 2 })
  })

  it("отвечает NOT_FOUND на истёкшую ссылку и закрывает запрос", async () => {
    const world = createWorld({
      request: {
        userId: "user-1",
        tokenHash: hashOpaqueToken("stale-token"),
        expiresAt: new Date(NOW.getTime() - 60_000),
        createdAt: new Date(NOW.getTime() - 61 * 60_000)
      }
    })
    vi.setSystemTime(NOW)

    await expect(
      resolver.Mutation.confirmAccountArchive(null, { token: "stale-token" }, world.ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND", entity: "accountArchive" } })
    expect(world.currentRequest()).toBeNull()
    expect(world.users[0]!.archivedAt).toBeNull()
  })

  it("не принимает чужую ссылку и чужой запрос не закрывает", async () => {
    const other = account({ id: "user-2", email: "other@example.test" })
    const world = createWorld({
      users: [account(), other],
      request: {
        userId: "user-2",
        tokenHash: hashOpaqueToken("other-token"),
        expiresAt: new Date(NOW.getTime() + 30 * 60_000),
        createdAt: NOW
      }
    })
    vi.setSystemTime(NOW)

    await expect(
      resolver.Mutation.confirmAccountArchive(null, { token: "other-token" }, world.ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } })
    expect(world.currentRequest()).not.toBeNull()
  })
})

describe("экран состояния и восстановление", () => {
  const selfArchived = (overrides: Partial<FakeUser> = {}) =>
    account({ archivedAt: new Date("2026-09-20T10:00:00.000Z"), archiveMode: "self", ...overrides })

  it("отдаёт дату архива, число статей и план", async () => {
    const user = selfArchived()
    const world = createWorld({
      currentUser: user,
      articles: [article("article-1", "archived"), article("article-2", "archived")],
      grants: [
        {
          tier: "standard",
          startsAt: new Date("2026-09-01T00:00:00.000Z"),
          endsAt: new Date("2026-12-01T00:00:00.000Z"),
          revokedAt: null
        }
      ]
    })

    const state = await resolver.AccountUser.archiveState({ id: "user-1" }, {}, world.ctx)

    expect(state).toMatchObject({ mode: "self", articlesArchived: 2, canRestore: true })
    expect(state.archivedAt).toBe("2026-09-20T10:00:00.000Z")
    // План идёт независимо от архива (журнал #50): срок не сдвигается и не ставится на паузу.
    expect(state.plan).toMatchObject({ state: "active", tier: "standard", until: "2026-12-01T00:00:00.000Z" })
  })

  it("закрыт для действующего аккаунта и для административного архива — разными причинами", async () => {
    // Причины различаются намеренно: действующий аккаунт страница уводит в кабинет, а
    // административно архивированный оставляет у себя — иначе страницы зациклят редиректы.
    const active = createWorld()
    await expect(resolver.AccountUser.archiveState({ id: "user-1" }, {}, active.ctx)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN", action: "account.archive.state" }
    })

    const blocked = createWorld({ currentUser: selfArchived({ archiveMode: "admin" }) })
    await expect(resolver.AccountUser.archiveState({ id: "user-1" }, {}, blocked.ctx)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN", action: "account.restore.self" }
    })
  })

  it("AC-1: восстановление возвращает аккаунт и оставляет статьи в архиве", async () => {
    const world = createWorld({
      currentUser: selfArchived(),
      articles: [article("article-1", "archived"), article("article-2", "archived")]
    })

    const result = await resolver.Mutation.restoreAccountSelf(null, {}, world.ctx)

    expect(result.restored).toBe(true)
    expect(world.users[0]).toMatchObject({ archivedAt: null, archiveMode: null, archiveReason: null })
    expect(world.articles.every((row) => row.status === "archived")).toBe(true)
    expect(world.prisma.article.updateMany).not.toHaveBeenCalled()
  })

  it("меняет ограниченную сессию на полную и отзывает прежнюю", async () => {
    const world = createWorld({ currentUser: selfArchived() })

    const result = await resolver.Mutation.restoreAccountSelf(null, {}, world.ctx)

    expect(world.sessions.find((row) => row.id === "session-limited")!.revokedAt).not.toBeNull()
    const issued = world.sessions.filter((row) => row.revokedAt === null)
    expect(issued).toHaveLength(1)
    expect(issued[0]!.limited).toBe(false)
    expect(result.session.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/)
    expect(result.session.refreshToken).toHaveLength(64)
  })

  it("пишет аудит `user.restore.self` с числом дней в архиве", async () => {
    const world = createWorld({ currentUser: selfArchived() })
    vi.setSystemTime(new Date("2026-09-27T10:00:00.000Z"))

    await resolver.Mutation.restoreAccountSelf(null, {}, world.ctx)

    const record = world.audit.find((entry) => entry.action === "user.restore.self")
    expect(record).toMatchObject({ actorId: "user-1", entityType: "user", entityId: "user-1" })
    expect(record!.diff).toMatchObject({ mode: "self", archivedDays: 7 })
  })

  it("отказывает после административной блокировки и повторному восстановлению", async () => {
    const blocked = createWorld({ currentUser: selfArchived({ archiveMode: "emergency" }) })
    await expect(resolver.Mutation.restoreAccountSelf(null, {}, blocked.ctx)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" }
    })

    const active = createWorld()
    await expect(resolver.Mutation.restoreAccountSelf(null, {}, active.ctx)).rejects.toMatchObject({
      extensions: { code: "CONFLICT", expected: "archived" }
    })
  })
})
