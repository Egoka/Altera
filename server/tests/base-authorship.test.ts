import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import articleResolver from "../src/graphql/article/resolver"
import { BASE_AUTHORSHIP_REASON } from "../src/authorship/base-authorship"

const NOW = new Date("2026-09-20T12:00:00.000Z")
const PAST = new Date("2026-08-01T00:00:00.000Z")
const FUTURE = new Date("2099-01-01T00:00:00.000Z")

const reader = {
  id: "reader-1",
  role: "reader",
  archivedAt: null,
  isServiceAccount: false,
  planTier: "free",
  planUntil: null,
  locale: "ru"
}

interface GrantRow {
  id: string
  endsAt: Date | null
  revokedAt: Date | null
}

/** Один мок на обе транзакции: включение базового авторства и создание черновика. */
const prismaMock = (grants: GrantRow[] = []) => {
  const planGrantFindMany = vi.fn().mockResolvedValue(grants)
  const planGrantCreate = vi.fn().mockResolvedValue({ id: "grant-1" })
  const userUpdate = vi.fn().mockResolvedValue({})
  const auditLogCreate = vi.fn().mockResolvedValue({})
  const articleCreate = vi.fn().mockResolvedValue({ id: "article-1", status: "draft" })
  const sectionFindFirst = vi.fn().mockResolvedValue(null)

  const $transaction = vi.fn(async (operation: (client: unknown) => Promise<unknown>) =>
    operation({
      planGrant: { findMany: planGrantFindMany, create: planGrantCreate },
      user: { update: userUpdate },
      auditLog: { create: auditLogCreate },
      article: { create: articleCreate },
      section: { findFirst: sectionFindFirst }
    })
  )

  return { $transaction, planGrantFindMany, planGrantCreate, userUpdate, auditLogCreate, articleCreate }
}

const context = (prisma: unknown, currentUser: object) =>
  ({
    prisma,
    currentUser,
    requestId: "request-1",
    logger: { log: vi.fn() },
    cache: { delByTags: vi.fn() }
  }) as never

describe("базовое авторство при первом «Создать статью»", () => {
  it("включает бессрочную базовую выдачу, обновляет кэш плана и пишет author.enabled", async () => {
    const prisma = prismaMock()

    await expect(
      articleResolver.Mutation.createArticle(null, { input: {} }, context(prisma, reader))
    ).resolves.toMatchObject({ id: "article-1", status: "draft" })

    expect(prisma.planGrantCreate).toHaveBeenCalledWith({
      data: {
        userId: "reader-1",
        tier: "standard",
        endsAt: null,
        grantedById: null,
        reason: BASE_AUTHORSHIP_REASON
      },
      select: { id: true }
    })
    expect(prisma.userUpdate).toHaveBeenCalledWith({
      where: { id: "reader-1" },
      data: { role: "author", planTier: "standard", planUntil: null }
    })
    expect(prisma.auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "author.enabled",
        actorId: "reader-1",
        actorRole: "reader",
        entityType: "user",
        entityId: "reader-1",
        diff: expect.objectContaining({ userId: "reader-1", grantId: "grant-1" }),
        requestId: "request-1"
      })
    })
    // Черновик создаётся тем же вызовом и принадлежит включённому автору (article-new.md §4).
    expect(prisma.articleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ authorId: "reader-1", status: "draft" }) })
    )
  })

  it("не дублирует выдачу при повторном нажатии автора с базовым авторством", async () => {
    const prisma = prismaMock()
    const enabledAuthor = { ...reader, id: "author-1", role: "author", planTier: "standard", planUntil: null }

    await articleResolver.Mutation.createArticle(null, { input: {} }, context(prisma, enabledAuthor))

    expect(prisma.planGrantFindMany).not.toHaveBeenCalled()
    expect(prisma.planGrantCreate).not.toHaveBeenCalled()
    expect(prisma.auditLogCreate).not.toHaveBeenCalled()
    expect(prisma.articleCreate).toHaveBeenCalled()
  })

  it("чинит расхождение кэша по действующей бессрочной выдаче без второй выдачи и второго события", async () => {
    const prisma = prismaMock([{ id: "grant-1", endsAt: null, revokedAt: null }])

    await articleResolver.Mutation.createArticle(null, { input: {} }, context(prisma, reader))

    expect(prisma.planGrantFindMany).toHaveBeenCalledWith({
      where: { userId: "reader-1" },
      select: { id: true, endsAt: true, revokedAt: true }
    })
    expect(prisma.planGrantCreate).not.toHaveBeenCalled()
    expect(prisma.auditLogCreate).not.toHaveBeenCalled()
    expect(prisma.userUpdate).toHaveBeenCalled()
    expect(prisma.articleCreate).toHaveBeenCalled()
  })

  it("оставляет действующий платный план нетронутым", async () => {
    const prisma = prismaMock()
    const paidAuthor = { ...reader, id: "author-2", role: "author", planTier: "pro", planUntil: FUTURE }

    await articleResolver.Mutation.createArticle(null, { input: {} }, context(prisma, paidAuthor))

    expect(prisma.planGrantFindMany).not.toHaveBeenCalled()
    expect(prisma.planGrantCreate).not.toHaveBeenCalled()
    expect(prisma.userUpdate).not.toHaveBeenCalled()
  })

  it("не превращает истёкшую срочную выдачу в бессрочную: создание закрыто PLAN_LIMIT", async () => {
    const prisma = prismaMock([{ id: "grant-past", endsAt: PAST, revokedAt: null }])
    const expiredAuthor = { ...reader, id: "author-3", role: "author", planTier: "standard", planUntil: PAST }

    await expect(
      articleResolver.Mutation.createArticle(null, { input: {} }, context(prisma, expiredAuthor))
    ).rejects.toMatchObject<Partial<GraphQLError>>({ extensions: { code: "PLAN_LIMIT", requiredTier: "standard" } })

    expect(prisma.planGrantCreate).not.toHaveBeenCalled()
    expect(prisma.userUpdate).not.toHaveBeenCalled()
    expect(prisma.articleCreate).not.toHaveBeenCalled()
  })

  it("не выдаёт базовое авторство повторно после отзыва бессрочной выдачи", async () => {
    const prisma = prismaMock([{ id: "grant-revoked", endsAt: null, revokedAt: PAST }])

    await expect(
      articleResolver.Mutation.createArticle(null, { input: {} }, context(prisma, reader))
    ).rejects.toMatchObject<Partial<GraphQLError>>({ extensions: { code: "PLAN_LIMIT" } })

    expect(prisma.planGrantCreate).not.toHaveBeenCalled()
    expect(prisma.auditLogCreate).not.toHaveBeenCalled()
  })
})

describe("служебные записи базовое авторство не получают", () => {
  it.each(["owner", "admin", "moderator", "analyst"])("отказывает роли %s без выдачи", async (role) => {
    const prisma = prismaMock()
    const serviceUser = { ...reader, id: `${role}-1`, role, isServiceAccount: true }

    await expect(
      articleResolver.Mutation.createArticle(null, { input: {} }, context(prisma, serviceUser))
    ).rejects.toMatchObject<Partial<GraphQLError>>({ extensions: { code: "FORBIDDEN" } })

    expect(prisma.planGrantCreate).not.toHaveBeenCalled()
    expect(prisma.userUpdate).not.toHaveBeenCalled()
    expect(prisma.auditLogCreate).not.toHaveBeenCalled()
  })

  it("отказывает служебной записи с читательской ролью", async () => {
    const prisma = prismaMock()

    await expect(
      articleResolver.Mutation.createArticle(
        null,
        { input: {} },
        context(prisma, { ...reader, id: "service-1", isServiceAccount: true })
      )
    ).rejects.toMatchObject<Partial<GraphQLError>>({ extensions: { code: "FORBIDDEN" } })

    expect(prisma.planGrantFindMany).not.toHaveBeenCalled()
    expect(prisma.planGrantCreate).not.toHaveBeenCalled()
  })

  it("не выдаёт авторство редактору: редакционный черновик создаётся по роли", async () => {
    const prisma = prismaMock()

    await articleResolver.Mutation.createArticle(
      null,
      { input: {} },
      context(prisma, { ...reader, id: "editor-1", role: "editor", isServiceAccount: true })
    )

    expect(prisma.planGrantCreate).not.toHaveBeenCalled()
    expect(prisma.articleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isEditorial: true }) })
    )
  })

  it("отказывает архивированному читателю и авторства не включает", async () => {
    const prisma = prismaMock()

    await expect(
      articleResolver.Mutation.createArticle(null, { input: {} }, context(prisma, { ...reader, archivedAt: NOW }))
    ).rejects.toMatchObject<Partial<GraphQLError>>({ extensions: { code: "FORBIDDEN" } })

    expect(prisma.planGrantCreate).not.toHaveBeenCalled()
  })
})
