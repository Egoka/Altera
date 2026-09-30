import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import articleResolver from "../src/graphql/article/resolver"
import { BASE_AUTHORSHIP_REASON, enableBaseAuthorship } from "../src/authorship/base-authorship"

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
  tier?: "standard" | "pro"
  startsAt?: Date
  endsAt: Date | null
  grantedById: string | null
  revokedAt: Date | null
}

/** Срочная админская выдача: со сроком и выдавшим сотрудником (`grants-and-promo.md`). */
const adminGrant = (id: string, endsAt: Date, overrides: Partial<GrantRow> = {}): GrantRow => ({
  id,
  tier: "standard",
  startsAt: PAST,
  endsAt,
  grantedById: "admin-1",
  revokedAt: null,
  ...overrides
})

/** Автоматическая базовая выдача первого запуска: бессрочная, без выдавшего (`plan-free.md` п. 6а). */
const baseGrant = (overrides: Partial<GrantRow> = {}): GrantRow => ({
  id: "grant-base",
  tier: "standard",
  startsAt: PAST,
  endsAt: null,
  grantedById: null,
  revokedAt: null,
  ...overrides
})

/** Один мок на обе транзакции: включение базового авторства и создание черновика. */
const prismaMock = (grants: GrantRow[] = [], role: "reader" | "author" = "reader") => {
  const planGrantFindMany = vi.fn().mockResolvedValue(grants)
  const planGrantCreate = vi.fn().mockImplementation(async () => {
    // Созданная базовая выдача попадает в пересчёт кэша того же коммита.
    grants.push(baseGrant({ id: "grant-1", startsAt: NOW }))
    return { id: "grant-1" }
  })
  const userFindUnique = vi.fn().mockResolvedValue({ role, isServiceAccount: false })
  const userUpdate = vi.fn().mockResolvedValue({})
  const auditLogCreate = vi.fn().mockResolvedValue({})
  const articleCreate = vi.fn().mockResolvedValue({ id: "article-1", status: "draft" })
  const sectionFindFirst = vi.fn().mockResolvedValue(null)

  const $transaction = vi.fn(async (operation: (client: unknown) => Promise<unknown>) =>
    operation({
      $executeRawUnsafe: vi.fn(),
      planGrant: { findMany: planGrantFindMany, create: planGrantCreate },
      user: { findUnique: userFindUnique, update: userUpdate },
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
        startsAt: expect.any(Date),
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
    const prisma = prismaMock([baseGrant()])

    await articleResolver.Mutation.createArticle(null, { input: {} }, context(prisma, reader))

    expect(prisma.planGrantFindMany).toHaveBeenCalledWith({
      where: { userId: "reader-1" },
      select: { id: true, endsAt: true, grantedById: true, revokedAt: true }
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

  // AC-3. На первом запуске платности нет, поэтому прошлая админская выдача первому нажатию не
  // мешает: `plan-free.md` п. 3 начинает действовать только после включения платности (§24.1).
  it("открывает базовое авторство читателю с истёкшей админской выдачей (AC-3)", async () => {
    const prisma = prismaMock([adminGrant("grant-past", PAST)])
    const expiredReader = { ...reader, id: "reader-2", planTier: "standard", planUntil: PAST }

    await expect(
      articleResolver.Mutation.createArticle(null, { input: {} }, context(prisma, expiredReader))
    ).resolves.toMatchObject({ id: "article-1", status: "draft" })

    expect(prisma.planGrantCreate).toHaveBeenCalledWith({
      data: {
        userId: "reader-2",
        tier: "standard",
        startsAt: expect.any(Date),
        endsAt: null,
        grantedById: null,
        reason: BASE_AUTHORSHIP_REASON
      },
      select: { id: true }
    })
    expect(prisma.userUpdate).toHaveBeenCalledWith({
      where: { id: "reader-2" },
      data: { role: "author", planTier: "standard", planUntil: null }
    })
    expect(prisma.auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "author.enabled" }) })
    )
  })

  it("открывает базовое авторство и после отозванной админской выдачи (AC-3)", async () => {
    const prisma = prismaMock([adminGrant("grant-revoked", FUTURE, { revokedAt: PAST })])

    await expect(
      articleResolver.Mutation.createArticle(null, { input: {} }, context(prisma, reader))
    ).resolves.toMatchObject({ id: "article-1" })

    expect(prisma.planGrantCreate).toHaveBeenCalled()
  })

  // Отозванная базовая выдача — другой случай: её снимает согласованное архивирование аккаунта,
  // и второй раз базовое авторство не открывается (журнал §27.1).
  it("не выдаёт базовое авторство повторно после отзыва базовой выдачи", async () => {
    const prisma = prismaMock([baseGrant({ revokedAt: PAST })])

    await expect(
      articleResolver.Mutation.createArticle(null, { input: {} }, context(prisma, reader))
    ).rejects.toMatchObject<Partial<GraphQLError>>({ extensions: { code: "PLAN_LIMIT" } })

    expect(prisma.planGrantCreate).not.toHaveBeenCalled()
    expect(prisma.auditLogCreate).not.toHaveBeenCalled()
    expect(prisma.userUpdate).not.toHaveBeenCalled()
  })

  // Устаревший кэш не должен понизить уровень: действующая админская выдача приоритетнее
  // базовой (журнал §8.22), и дальше запрос идёт по пересчитанному значению.
  it("при действующей админской выдаче кэш получает её уровень и срок, а не базовый", async () => {
    const prisma = prismaMock([adminGrant("grant-pro", FUTURE, { tier: "pro" })])

    await articleResolver.Mutation.createArticle(null, { input: {} }, context(prisma, reader))

    expect(prisma.planGrantCreate).toHaveBeenCalled()
    expect(prisma.userUpdate).toHaveBeenCalledWith({
      where: { id: "reader-1" },
      data: { role: "author", planTier: "pro", planUntil: FUTURE }
    })
  })
})

describe("начало базовой выдачи", () => {
  // Со значением по умолчанию базу выставила бы `startsAt` позже переданного `now`, и пересчёт
  // кэша в той же транзакции счёл бы свежую выдачу будущей, а план — отсутствующим.
  it("совпадает с «сейчас» вызова, а не со значением по умолчанию базы", async () => {
    const prisma = prismaMock()

    const actor = await enableBaseAuthorship(
      { prisma, currentUser: reader, requestId: "request-1" } as never,
      "article.create",
      NOW
    )

    expect(prisma.planGrantCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ startsAt: NOW }) })
    )
    expect(actor).toMatchObject({ role: "author", planTier: "standard", planUntil: null })
    expect(prisma.userUpdate).toHaveBeenCalledWith({
      where: { id: "reader-1" },
      data: { role: "author", planTier: "standard", planUntil: null }
    })
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
