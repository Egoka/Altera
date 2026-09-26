import { describe, expect, it, vi } from "vitest"
import sectionResolver from "../src/graphql/section/resolver"
import { publicSectionSelect } from "../src/visibility/article"

const admin = { id: "admin-1", role: "admin" as const }

describe("admin categories GraphQL", () => {
  it("loads the successor needed for a permanent public section redirect", async () => {
    const section = {
      id: "culture",
      slug: "culture",
      status: "archived",
      successor: { id: "science", slug: "science", status: "active" }
    }
    const findUnique = vi.fn().mockResolvedValue(section)
    const context = {
      prisma: { section: { findUnique } },
      cache: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn()
      }
    }

    await expect(sectionResolver.Query.section({}, { slug: "culture" }, context as never)).resolves.toEqual(section)
    // Публичный запрос отдаёт только публичные поля рубрики и её преемника (T-027).
    expect(findUnique).toHaveBeenCalledWith({
      where: { slug: "culture" },
      select: { ...publicSectionSelect, successor: { select: publicSectionSelect } }
    })
  })

  it("returns formats with article counts for taxonomy admins", async () => {
    const count = vi.fn().mockResolvedValue(1)
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { id: "format-1", name: "Интервью", slug: "interview", status: "active", _count: { articles: 3 } }
      ])
    const context = {
      currentUser: admin,
      requestId: "request-1",
      prisma: { format: { count, findMany } }
    }

    await expect(
      sectionResolver.Query.formats(
        {},
        {
          pagination: { page: 1, limit: 20 },
          sort: { field: "name", direction: "ASC" },
          filters: { status: ["active"] }
        },
        context as never
      )
    ).resolves.toMatchObject({
      formats: [{ id: "format-1", _count: { articles: 3 } }],
      pagination: { totalItems: 1 }
    })
  })

  it("returns only audit entries for the requested taxonomy entity", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "audit-1", action: "section.archive" }])
    const context = {
      currentUser: admin,
      requestId: "request-2",
      prisma: { auditLog: { findMany } }
    }

    await expect(
      sectionResolver.Query.taxonomyAudit({}, { entityType: "Section", entityId: "section-1" }, context as never)
    ).resolves.toEqual([{ id: "audit-1", action: "section.archive" }])
    expect(findMany).toHaveBeenCalledWith({
      where: { entityType: "Section", entityId: "section-1" },
      orderBy: { createdAt: "desc" },
      take: 20
    })
  })

  // T-132: раздел получает `NOT_FOUND` вместо внутренней ошибки, если рубрика исчезла
  // между открытием карточки и восстановлением (`40-admin/categories.md` §2).
  it("answers NOT_FOUND when the section to restore no longer exists", async () => {
    const transaction = vi.fn().mockRejectedValue(Object.assign(new Error("record not found"), { code: "P2025" }))
    const context = {
      currentUser: admin,
      requestId: "request-restore-missing",
      prisma: { $transaction: transaction },
      cache: { delByTags: vi.fn() }
    }

    await expect(
      sectionResolver.Mutation.restoreSection({}, { id: "missing" }, context as never)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND", entity: "section" } })
  })

  it("passes the card version from the client into the section update", async () => {
    const version = new Date("2026-09-26T12:00:00.000Z")
    const findUnique = vi.fn().mockResolvedValue({ slug: "culture", name: "Культура", updatedAt: version })
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const findUniqueOrThrow = vi.fn().mockResolvedValue({ id: "culture", slug: "culture" })
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        section: { findUnique, updateMany, findUniqueOrThrow },
        sectionSlugHistory: {},
        auditLog: { create: vi.fn() }
      })
    )
    const context = {
      currentUser: admin,
      requestId: "request-version",
      prisma: { $transaction: transaction, section: { findUnique: vi.fn().mockResolvedValue({ slug: "culture" }) } },
      cache: { delByTags: vi.fn() }
    }

    await sectionResolver.Mutation.updateSection(
      {},
      { id: "culture", input: { name: "Новое" }, expectedUpdatedAt: version.toISOString() },
      context as never
    )

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "culture", updatedAt: version },
      data: { name: "Новое" }
    })
  })

  it("audits each changed section order in the reorder transaction", async () => {
    const update = vi
      .fn()
      .mockImplementation(({ where, data }) => ({ id: where.id, slug: where.id, order: data.order }))
    const createAudit = vi.fn().mockResolvedValue({})
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({ section: { update }, auditLog: { create: createAudit } })
    )
    const context = {
      currentUser: admin,
      requestId: "request-3",
      prisma: { $transaction: transaction },
      cache: { delByTags: vi.fn() }
    }

    await sectionResolver.Mutation.reorderSections(
      {},
      {
        input: {
          items: [
            { id: "culture", order: 2 },
            { id: "science", order: 1 }
          ]
        }
      },
      context as never
    )

    expect(createAudit).toHaveBeenCalledTimes(2)
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "section.update", entityId: "culture", requestId: "request-3" })
    })
  })
})
