import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import adminUsersResolver from "../src/graphql/admin-users/resolver"
import articleResolver from "../src/graphql/article/resolver"
import {
  adminChangeEmail,
  archiveAccount,
  getAdminUser,
  listAdminUsers,
  restoreAccount,
  revokeUserSessions
} from "../src/admin/users"
import {
  adminUsersContext,
  auditsOf,
  MemoryPrisma,
  memoryArticle,
  memorySession,
  memoryUser,
  type MemoryRole,
  type MemoryUser
} from "./helpers/admin-users-double"

/**
 * T-073: раздел админки «Пользователи» (`docs/spec/40-admin/users.md`) и flow #11
 * (`docs/spec/10-flows/archive-account.md`).
 *
 * Критерий №1 — открытие карточки пишет `admin.read.personal`. Критерий №2 — блокировка
 * архивирует статьи с актором-сотрудником, и автор их не восстанавливает. Остальные наборы
 * закрывают маску адреса в списке, зону сессий аналитика, режимы архива, восстановление без
 * возврата статей, отзыв сессий и смену адреса сотрудником.
 */

const now = new Date("2026-09-28T12:00:00.000Z")

const staff = (role: MemoryRole): MemoryUser =>
  memoryUser({ id: `${role}-1`, role, isServiceAccount: true, handle: `staff-${role}`, name: `Сотрудник ${role}` })

const reader = memoryUser({ id: "reader-1", handle: "vera", name: "Вера Орлова", email: "vera.orlova@example.test" })
const author = memoryUser({
  id: "author-1",
  role: "author",
  handle: "oleg",
  name: "Олег Петров",
  email: "oleg@example.test",
  planTier: "standard",
  planUntil: new Date("2026-12-01T00:00:00.000Z")
})

const extensionsOf = (error: unknown): Record<string, unknown> => {
  expect(error).toBeInstanceOf(GraphQLError)
  return (error as GraphQLError).extensions as Record<string, unknown>
}

async function capture(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await run()
  } catch (error: unknown) {
    return extensionsOf(error)
  }
  throw new Error("Expected the call to reject")
}

describe("список пользователей", () => {
  it("отдаёт адрес маской и не пишет чтение персональных данных", async () => {
    const prisma = new MemoryPrisma({ users: [reader, author, staff("admin")] })
    const ctx = adminUsersContext(prisma, staff("admin"))

    const list = await listAdminUsers(ctx, {}, now)

    expect(list.items.map(({ id }) => id).sort()).toEqual(["author-1", "reader-1"])
    expect(list.items.every(({ emailMasked }) => emailMasked)).toBe(true)
    expect(list.items.find(({ id }) => id === "reader-1")?.email).toBe("v***a@example.test")
    // Просмотр списка с маской в аудит не пишется (`users.md` §8).
    expect(auditsOf(prisma, "admin.read.personal")).toHaveLength(0)
  })

  it("не показывает служебные записи", async () => {
    const prisma = new MemoryPrisma({ users: [reader, staff("editor"), staff("owner")] })
    const list = await listAdminUsers(adminUsersContext(prisma, staff("owner")), {}, now)

    expect(list.items.map(({ id }) => id)).toEqual(["reader-1"])
  })

  it("по умолчанию показывает действующие записи, а по фильтру — архивные с режимом", async () => {
    const archived = memoryUser({
      id: "reader-2",
      handle: "nina",
      archivedAt: new Date("2026-09-20T00:00:00.000Z"),
      archiveMode: "emergency"
    })
    const prisma = new MemoryPrisma({ users: [reader, archived] })
    const ctx = adminUsersContext(prisma, staff("admin"))

    const active = await listAdminUsers(ctx, {}, now)
    const emergency = await listAdminUsers(ctx, { filters: { status: "archived", archiveMode: "emergency" } }, now)

    expect(active.items.map(({ id }) => id)).toEqual(["reader-1"])
    expect(emergency.items.map(({ id }) => id)).toEqual(["reader-2"])
    expect(emergency.items[0]?.archiveMode).toBe("emergency")
  })

  it("пишет чтение персональных данных на поиск, потому что он сверяется с адресом", async () => {
    const prisma = new MemoryPrisma({ users: [reader, author] })
    const ctx = adminUsersContext(prisma, staff("analyst"))

    const found = await listAdminUsers(ctx, { filters: { search: "vera.orlova@example.test" } }, now)
    const tooShort = await listAdminUsers(ctx, { filters: { search: "ve" } }, now)

    expect(found.items.map(({ id }) => id)).toEqual(["reader-1"])
    // Строка короче трёх знаков фильтром не считается и аудита не добавляет (§4).
    expect(tooShort.items).toHaveLength(2)
    const records = auditsOf(prisma, "admin.read.personal")
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      actorId: "analyst-1",
      actorRole: "analyst",
      entityId: "hash:vera.orlova@example.test",
      context: "admin.users",
      purpose: "admin.users.search"
    })
  })

  it("закрыт для редактора и модератора", async () => {
    const prisma = new MemoryPrisma({ users: [reader] })

    for (const role of ["editor", "moderator"] as const) {
      const extensions = await capture(() => listAdminUsers(adminUsersContext(prisma, staff(role)), {}, now))
      expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "admin.users.read" })
    }
  })
})

describe("карточка пользователя", () => {
  it("критерий №1: открытие пишет admin.read.personal и раскрывает полный адрес", async () => {
    const prisma = new MemoryPrisma({ users: [reader] })
    const ctx = adminUsersContext(prisma, staff("admin"))

    const card = await getAdminUser(ctx, "reader-1", now)

    expect(card).toMatchObject({ email: "vera.orlova@example.test", emailMasked: false })
    const records = auditsOf(prisma, "admin.read.personal")
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      action: "admin.read.personal",
      actorId: "admin-1",
      actorRole: "admin",
      entityType: "user",
      entityId: "reader-1",
      context: "admin.users",
      purpose: "admin.user.read",
      requestId: "req-admin-users"
    })
  })

  it("служебная запись и неизвестный идентификатор отвечают одинаково и аудита не пишут", async () => {
    const prisma = new MemoryPrisma({ users: [reader, staff("admin")] })
    const ctx = adminUsersContext(prisma, staff("owner"))

    expect(await getAdminUser(ctx, "admin-1", now)).toBeNull()
    expect(await getAdminUser(ctx, "missing", now)).toBeNull()
    expect(auditsOf(prisma, "admin.read.personal")).toHaveLength(0)
  })

  it("аналитику не отдаёт ни сессии, ни внутреннюю причину, ни кнопки", async () => {
    const archived = memoryUser({
      id: "reader-3",
      handle: "lev",
      archivedAt: new Date("2026-09-21T00:00:00.000Z"),
      archiveMode: "admin",
      archiveReason: "внутренняя причина для аудита",
      archiveReasonCategory: "spam_and_manipulation",
      archivePublicMessage: "Массовая рассылка ссылок"
    })
    const prisma = new MemoryPrisma({
      users: [archived],
      sessions: [memorySession({ id: "session-1", userId: "reader-3" })]
    })

    const analystCard = await getAdminUser(adminUsersContext(prisma, staff("analyst")), "reader-3", now)
    const adminCard = await getAdminUser(adminUsersContext(prisma, staff("admin")), "reader-3", now)

    expect(analystCard).toMatchObject({
      sessions: null,
      archiveInternalReason: null,
      archivePublicMessage: "Массовая рассылка ссылок",
      archiveReasonCategory: "spam_and_manipulation",
      canArchive: false,
      canRestore: false,
      canRevokeSessions: false,
      canChangeEmail: false
    })
    expect(adminCard?.archiveInternalReason).toBe("внутренняя причина для аудита")
    expect(adminCard?.sessions).toHaveLength(1)
    expect(adminCard?.sessions?.[0]).toMatchObject({ deviceClass: "desktop", browserClass: "chrome" })
    expect(adminCard).toMatchObject({ canRestore: true, canArchive: false })
  })

  it("показывает базовое авторство с датой первого «Создать статью» и статьи по статусам", async () => {
    const prisma = new MemoryPrisma({
      users: [author],
      grants: [
        {
          id: "grant-base",
          userId: "author-1",
          tier: "standard",
          startsAt: new Date("2026-09-03T10:00:00.000Z"),
          endsAt: null,
          grantedById: null,
          revokedAt: null
        }
      ],
      articles: [
        memoryArticle({ id: "art-1", authorId: "author-1", status: "published" }),
        memoryArticle({ id: "art-2", authorId: "author-1", status: "draft" }),
        memoryArticle({ id: "art-3", authorId: "author-1", status: "review" }),
        memoryArticle({ id: "art-4", authorId: "author-1", status: "archived" })
      ]
    })

    const card = await getAdminUser(adminUsersContext(prisma, staff("admin")), "author-1", now)

    expect(card?.baseAuthorship).toEqual({ enabled: true, enabledAt: new Date("2026-09-03T10:00:00.000Z") })
    expect(card?.articleStats).toEqual({ total: 4, draft: 1, review: 1, published: 1, archived: 1 })
    expect(card?.plan).toMatchObject({ state: "base", tier: "standard" })
  })
})

describe("блокировка аккаунта", () => {
  const archiveInput = {
    id: "author-1",
    reasonCategory: "rules_violation" as const,
    internalReason: "Повторное нарушение правил публикации",
    publicMessage: "Материалы нарушают правила публикации"
  }

  const withArticles = () =>
    new MemoryPrisma({
      users: [author],
      articles: [
        memoryArticle({ id: "art-1", authorId: "author-1", status: "published" }),
        memoryArticle({ id: "art-2", authorId: "author-1", status: "draft" }),
        memoryArticle({
          id: "art-3",
          authorId: "author-1",
          status: "archived",
          archivedAt: new Date("2026-09-10T00:00:00.000Z"),
          archivedByActorId: "author-1",
          archivedByRole: "author",
          archiveReason: "author"
        })
      ],
      sessions: [
        memorySession({ id: "session-1", userId: "author-1" }),
        memorySession({ id: "session-2", userId: "author-1" })
      ]
    })

  it("критерий №2: архивирует статьи с актором-сотрудником и закрывает доступ одной операцией", async () => {
    const prisma = withArticles()
    const ctx = adminUsersContext(prisma, staff("admin"))

    const card = await archiveAccount(ctx, archiveInput, now)

    expect(card).toMatchObject({
      status: "archived",
      archiveMode: "admin",
      archiveReasonCategory: "rules_violation",
      archivePublicMessage: "Материалы нарушают правила публикации",
      archiveInternalReason: "Повторное нарушение правил публикации"
    })
    // Каскад коснулся только действующих материалов; актор — сотрудник и его уровень прав.
    const cascaded = prisma.articles.filter(({ id }) => id === "art-1" || id === "art-2")
    expect(cascaded.every((article) => article.status === "archived")).toBe(true)
    expect(cascaded.every((article) => article.archivedByActorId === "admin-1")).toBe(true)
    expect(cascaded.every((article) => article.archivedByRole === "admin")).toBe(true)
    expect(cascaded.every((article) => article.archiveReason === "account_archive")).toBe(true)
    // Ранее архивированная автором статья актора не меняет: иначе автор потерял бы её навсегда.
    expect(prisma.articles.find(({ id }) => id === "art-3")).toMatchObject({
      archivedByActorId: "author-1",
      archivedByRole: "author"
    })
    expect(prisma.sessions.every(({ revokedAt }) => revokedAt !== null)).toBe(true)

    const [record] = auditsOf(prisma, "user.archive")
    expect(record).toMatchObject({
      actorId: "admin-1",
      actorRole: "admin",
      entityType: "user",
      entityId: "author-1"
    })
    expect(record?.diff).toMatchObject({
      mode: "admin",
      reasonCategory: "rules_violation",
      reason: "Повторное нарушение правил публикации",
      hasPublicMessage: true,
      cascadeArticles: 2,
      sessionsRevoked: 2,
      // Оплаченный план продолжает идти без возврата (журнал #50): срок попадает в запись.
      planUntil: "2026-12-01T00:00:00.000Z"
    })
    expect(auditsOf(prisma, "article.archive")).toHaveLength(2)
  })

  it("критерий №2: автор не восстанавливает статью, архивированную каскадом блокировки", async () => {
    const prisma = withArticles()
    await archiveAccount(adminUsersContext(prisma, staff("admin")), archiveInput, now)
    const archivedArticle = prisma.articles.find(({ id }) => id === "art-1")!

    const update = vi.fn()
    const auditCreate = vi.fn()
    const authorContext = {
      currentUser: { id: "author-1", role: "author", archivedAt: null, planTier: "standard", planUntil: null },
      requestId: "req-author-restore",
      prisma: {
        $transaction: (run: (tx: unknown) => Promise<unknown>) =>
          run({
            article: {
              findUnique: vi
                .fn()
                .mockResolvedValue({ ...archivedArticle, author: { handle: "oleg" }, section: null, tags: [] }),
              update
            },
            auditLog: { create: auditCreate }
          })
      },
      cache: { delByTags: vi.fn() },
      logger: { log: vi.fn() }
    }

    const extensions = await capture(() =>
      articleResolver.Mutation.restoreArticle({}, { id: "art-1" }, authorContext as never)
    )

    expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "article.restore" })
    expect(update).not.toHaveBeenCalled()
    expect(auditCreate).not.toHaveBeenCalled()
  })

  it("экстренная блокировка проходит при действующем плане и пишет свой режим", async () => {
    const prisma = withArticles()

    const card = await archiveAccount(
      adminUsersContext(prisma, staff("owner")),
      { ...archiveInput, reasonCategory: "security_threat", mode: "emergency" },
      now
    )

    expect(card.archiveMode).toBe("emergency")
    expect(auditsOf(prisma, "user.archive")[0]?.diff).toMatchObject({
      mode: "emergency",
      reasonCategory: "security_threat",
      planUntil: "2026-12-01T00:00:00.000Z"
    })
  })

  it("переводит самостоятельный архив в административный, а повторную блокировку отклоняет", async () => {
    const selfArchived = memoryUser({
      id: "reader-4",
      handle: "ilya",
      archivedAt: new Date("2026-09-15T00:00:00.000Z"),
      archiveMode: "self"
    })
    const prisma = new MemoryPrisma({ users: [selfArchived] })
    const ctx = adminUsersContext(prisma, staff("admin"))

    const converted = await archiveAccount(ctx, { ...archiveInput, id: "reader-4" }, now)
    expect(converted).toMatchObject({ archiveMode: "admin", status: "archived" })
    // Дата закрытия доступа не сдвигается: аккаунт уже был закрыт.
    expect(converted.archivedAt).toEqual(new Date("2026-09-15T00:00:00.000Z"))

    const extensions = await capture(() => archiveAccount(ctx, { ...archiveInput, id: "reader-4" }, now))
    expect(extensions).toMatchObject({ code: "CONFLICT", entity: "user", expected: "active", actual: "archived" })
  })

  it("требует внутреннюю причину и не принимает самостоятельный режим", async () => {
    const prisma = new MemoryPrisma({ users: [author] })
    const ctx = adminUsersContext(prisma, staff("admin"))

    expect(await capture(() => archiveAccount(ctx, { ...archiveInput, internalReason: "  " }, now))).toMatchObject({
      code: "VALIDATION_ERROR",
      field: "internalReason",
      rule: "required"
    })
    expect(await capture(() => archiveAccount(ctx, { ...archiveInput, mode: "self" }, now))).toMatchObject({
      code: "VALIDATION_ERROR",
      field: "mode"
    })
    expect(prisma.users.find(({ id }) => id === "author-1")?.archivedAt).toBeNull()
  })

  it("закрыт для аналитика", async () => {
    const prisma = new MemoryPrisma({ users: [author] })

    const extensions = await capture(() =>
      archiveAccount(adminUsersContext(prisma, staff("analyst")), archiveInput, now)
    )

    expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "account.archive.admin" })
    expect(prisma.users.find(({ id }) => id === "author-1")?.archivedAt).toBeNull()
  })
})

describe("восстановление аккаунта", () => {
  const archivedAuthor = memoryUser({
    id: "author-2",
    role: "author",
    handle: "maya",
    archivedAt: new Date("2026-09-20T00:00:00.000Z"),
    archiveMode: "admin",
    archiveReason: "Спам",
    archiveReasonCategory: "spam_and_manipulation",
    archivePublicMessage: "Накрутка просмотров"
  })

  it("возвращает доступ и оставляет статьи в архиве", async () => {
    const prisma = new MemoryPrisma({
      users: [archivedAuthor],
      articles: [
        memoryArticle({
          id: "art-9",
          authorId: "author-2",
          status: "archived",
          archivedAt: new Date("2026-09-20T00:00:00.000Z"),
          archivedByActorId: "admin-1",
          archivedByRole: "admin",
          archiveReason: "account_archive"
        })
      ]
    })
    const ctx = adminUsersContext(prisma, staff("admin"))

    const card = await restoreAccount(ctx, { id: "author-2", reason: "Оспаривание принято" }, now)

    expect(card).toMatchObject({
      status: "active",
      archiveMode: null,
      archivedAt: null,
      archiveReasonCategory: null,
      archivePublicMessage: null,
      archiveInternalReason: null
    })
    // Статьи не возвращаются автоматически: автор возвращает их сам (журнал §5.4, §25.7).
    expect(prisma.articles[0]).toMatchObject({ status: "archived", archivedByRole: "admin" })
    expect(auditsOf(prisma, "article.restore")).toHaveLength(0)
    expect(auditsOf(prisma, "user.restore")[0]?.diff).toMatchObject({
      mode: "admin",
      reason: "Оспаривание принято",
      articlesLeftArchived: 1
    })
  })

  it("восстановление действующего аккаунта отвечает конфликтом", async () => {
    const prisma = new MemoryPrisma({ users: [author] })

    const extensions = await capture(() =>
      restoreAccount(adminUsersContext(prisma, staff("owner")), { id: "author-1", reason: "по обращению" }, now)
    )

    expect(extensions).toMatchObject({ code: "CONFLICT", entity: "user", expected: "archived", actual: "active" })
  })
})

describe("отзыв сессий", () => {
  it("закрывает все сессии аккаунта и пишет user.sessions.revoke", async () => {
    const prisma = new MemoryPrisma({
      users: [reader],
      sessions: [
        memorySession({ id: "session-1", userId: "reader-1" }),
        memorySession({ id: "session-2", userId: "reader-1" }),
        memorySession({ id: "session-3", userId: "reader-1", revokedAt: new Date("2026-09-01T00:00:00.000Z") })
      ]
    })
    const ctx = adminUsersContext(prisma, staff("admin"))

    const result = await revokeUserSessions(ctx, { id: "reader-1" }, now)

    expect(result).toEqual({ revokedCount: 2 })
    expect(prisma.sessions.every(({ revokedAt }) => revokedAt !== null)).toBe(true)
    // Аккаунт остаётся действующим: отзыв сессий — не блокировка.
    expect(prisma.users[0]?.archivedAt).toBeNull()
    expect(auditsOf(prisma, "user.sessions.revoke")[0]).toMatchObject({
      actorId: "admin-1",
      entityId: "reader-1",
      diff: { targetId: "reader-1", revokedCount: 2 }
    })
  })
})

describe("смена адреса сотрудником", () => {
  it("меняет адрес, пишет аудит хэшами и снимает открытый самостоятельный запрос", async () => {
    const prisma = new MemoryPrisma({ users: [reader] })
    const ctx = adminUsersContext(prisma, staff("admin"))

    const result = await adminChangeEmail(
      ctx,
      { id: "reader-1", newEmail: "Vera.New@Example.test", reason: "Обращение о восстановлении доступа" },
      now
    )

    expect(result).toEqual({ emailMasked: "v***w@example.test", changedAt: now })
    expect(prisma.users[0]?.email).toBe("vera.new@example.test")
    expect(prisma.emailChangeDeletes).toEqual(["reader-1"])
    expect(auditsOf(prisma, "user.email.change")[0]?.diff).toEqual({
      targetId: "reader-1",
      via: "admin",
      reason: "Обращение о восстановлении доступа",
      previousEmailHash: "hash:vera.orlova@example.test",
      newEmailHash: "hash:vera.new@example.test"
    })
  })

  it("отклоняет занятый адрес, прежний адрес и неверный формат", async () => {
    const prisma = new MemoryPrisma({ users: [reader, author] })
    const ctx = adminUsersContext(prisma, staff("owner"))
    const base = { id: "reader-1", reason: "по обращению" }

    expect(await capture(() => adminChangeEmail(ctx, { ...base, newEmail: "oleg@example.test" }, now))).toMatchObject({
      code: "CONFLICT",
      entity: "user"
    })
    expect(
      await capture(() => adminChangeEmail(ctx, { ...base, newEmail: "vera.orlova@example.test" }, now))
    ).toMatchObject({ code: "VALIDATION_ERROR", field: "newEmail", rule: "different" })
    expect(await capture(() => adminChangeEmail(ctx, { ...base, newEmail: "не-адрес" }, now))).toMatchObject({
      code: "VALIDATION_ERROR",
      field: "newEmail",
      rule: "email"
    })
    expect(prisma.users[0]?.email).toBe("vera.orlova@example.test")
  })
})

describe("контракт раздела", () => {
  it("отдаёт все даты строками, включая срок плана и сессии", async () => {
    const prisma = new MemoryPrisma({
      users: [author],
      grants: [
        {
          id: "grant-paid",
          userId: "author-1",
          tier: "standard",
          startsAt: new Date("2026-09-01T00:00:00.000Z"),
          endsAt: new Date("2026-12-01T00:00:00.000Z"),
          grantedById: "admin-1",
          revokedAt: null
        }
      ],
      articles: [memoryArticle({ id: "art-1", authorId: "author-1" })],
      sessions: [memorySession({ id: "session-1", userId: "author-1" })],
      consents: [{ userId: "author-1", acceptedAt: now, legalText: { kind: "terms", version: 3, locale: "ru" } }]
    })
    const ctx = adminUsersContext(prisma, staff("admin"))

    const list = await adminUsersResolver.Query.adminUsers({}, {}, ctx)
    const card = await adminUsersResolver.Query.adminUser({}, { id: "author-1" }, ctx)

    // Схема объявляет эти поля строками: объект `Date` доехал бы до экрана как `Invalid Date`.
    expect(list.items[0]?.plan).toMatchObject({ until: "2026-12-01T00:00:00.000Z", endedAt: null })
    expect(typeof list.items[0]?.createdAt).toBe("string")
    expect(card?.plan.until).toBe("2026-12-01T00:00:00.000Z")
    expect(typeof card?.articles[0]?.createdAt).toBe("string")
    expect(typeof card?.sessions?.[0]?.lastActiveAt).toBe("string")
    expect(typeof card?.consents[0]?.acceptedAt).toBe("string")
    expect(card?.baseAuthorship.enabledAt).toBeNull()
  })
})
