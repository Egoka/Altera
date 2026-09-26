import { describe, expect, it, vi } from "vitest"
import {
  archiveFormat,
  archiveSection,
  archiveTag,
  createFormat,
  createSection,
  createTag,
  mergeTags,
  restoreFormat,
  restoreSection,
  restoreTag,
  updateFormat,
  updateSection,
  updateTag
} from "../src/taxonomy/service"

const actor = (role: "author" | "admin" | "owner") => ({ id: `${role}-1`, role })

describe("taxonomy service", () => {
  it("rejects an inactive section successor without changing articles or history", async () => {
    const updateArticles = vi.fn()
    const updateHistory = vi.fn()
    const updateSection = vi.fn()
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $queryRaw: vi.fn().mockResolvedValue([
          { id: "source", status: "active" },
          { id: "target", status: "archived" }
        ]),
        article: { updateMany: updateArticles },
        sectionSlugHistory: { updateMany: updateHistory },
        section: { update: updateSection }
      })
    )

    await expect(
      archiveSection({ $transaction: transaction } as never, {
        sectionId: "source",
        successorId: "target",
        reason: "Taxonomy cleanup",
        actor: actor("admin"),
        requestId: "request-1"
      })
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } })

    expect(updateArticles).not.toHaveBeenCalled()
    expect(updateHistory).not.toHaveBeenCalled()
    expect(updateSection).not.toHaveBeenCalled()
  })

  it("moves articles and redirects every historical slug before archiving a section", async () => {
    const updateArticles = vi.fn().mockResolvedValue({ count: 2 })
    const updateHistory = vi.fn().mockResolvedValue({ count: 2 })
    const createAudit = vi.fn().mockResolvedValue({})
    const archived = { id: "source", status: "archived", successorId: "target", slug: "culture" }
    const updateSection = vi.fn().mockResolvedValue(archived)
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $queryRaw: vi.fn().mockResolvedValue([
          { id: "source", status: "active" },
          { id: "target", status: "active" }
        ]),
        article: { updateMany: updateArticles },
        auditLog: { create: createAudit },
        sectionSlugHistory: { updateMany: updateHistory },
        section: { update: updateSection }
      })
    )

    await expect(
      archiveSection({ $transaction: transaction } as never, {
        sectionId: "source",
        successorId: "target",
        reason: "Taxonomy cleanup",
        actor: actor("owner"),
        requestId: "request-1"
      })
    ).resolves.toEqual(archived)

    expect(updateArticles).toHaveBeenCalledWith({ where: { sectionId: "source" }, data: { sectionId: "target" } })
    expect(updateHistory).toHaveBeenCalledWith({
      where: { ownerSectionId: "source" },
      data: { redirectToSectionId: "target" }
    })
    expect(updateSection).toHaveBeenCalledWith({
      where: { id: "source" },
      data: expect.objectContaining({
        status: "archived",
        successorId: "target",
        archivedByActorId: "owner-1",
        archivedByRole: "owner"
      })
    })
    expect(createAudit).toHaveBeenCalledWith({
      data: {
        action: "section.archive",
        actorId: "owner-1",
        actorRole: "owner",
        entityType: "Section",
        entityId: "source",
        diff: { successorId: "target", movedArticles: 2, reason: "Taxonomy cleanup" },
        requestId: "request-1"
      }
    })
  })

  it("lets an author create a tag and records the creator snapshot atomically", async () => {
    const reserve = vi.fn().mockResolvedValue({})
    const created = { id: "tag-1", slug: "photo-story", status: "active" }
    const create = vi.fn().mockResolvedValue(created)
    const assign = vi.fn().mockResolvedValue({})
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        tagSlugHistory: { create: reserve, update: assign },
        tag: { create }
      })
    )

    await expect(
      createTag({ $transaction: transaction } as never, {
        input: { name: "Photo story" },
        actor: actor("author"),
        requestId: "request-1"
      })
    ).resolves.toEqual(created)

    expect(reserve).toHaveBeenCalledWith({ data: { slug: "photo-story" } })
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Photo story",
        slug: "photo-story",
        createdByActorId: "author-1",
        createdByRole: "author"
      })
    })
    expect(assign).toHaveBeenCalledWith({
      where: { slug: "photo-story" },
      data: { ownerTagId: "tag-1", redirectToTagId: "tag-1" }
    })
  })

  it("rejects section archival without a reason before opening a transaction", async () => {
    const transaction = vi.fn()

    await expect(
      archiveSection({ $transaction: transaction } as never, {
        sectionId: "source",
        successorId: "target",
        reason: "  ",
        actor: actor("admin"),
        requestId: "request-reason"
      })
    ).rejects.toMatchObject({ extensions: { code: "VALIDATION_ERROR" } })
    expect(transaction).not.toHaveBeenCalled()
  })

  it.each([
    [{ name: "Anything", slug: " Photo-Story " }, "photo-story"],
    [{ name: "Фотоистория Съёмки" }, "fotoistoriya-semki"],
    [{ name: "  Жизнь & щи!  " }, "zhizn-schi"],
    [{ name: "Café Crème" }, "cafe-creme"]
  ])("reserves the normalized or derived slug for %j", async (input, slug) => {
    const reserve = vi.fn().mockResolvedValue({})
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        tagSlugHistory: { create: reserve, update: vi.fn().mockResolvedValue({}) },
        tag: { create: vi.fn().mockResolvedValue({ id: "tag-1", slug }) }
      })
    )

    await createTag({ $transaction: transaction } as never, {
      input,
      actor: actor("author"),
      requestId: "request-1"
    })

    expect(reserve).toHaveBeenCalledWith({ data: { slug } })
  })

  it.each([
    [{ name: "!!! ъ ь" }, "name", "slug-source"],
    [{ name: "Photo", slug: "Photo Story" }, "slug", "lowercase-latin-slug"]
  ])("rejects %j before touching the slug registry", async (input, field, rule) => {
    const transaction = vi.fn()

    await expect(
      createTag({ $transaction: transaction } as never, { input, actor: actor("author"), requestId: "request-1" })
    ).rejects.toMatchObject({ extensions: { code: "VALIDATION_ERROR", field, rule } })
    expect(transaction).not.toHaveBeenCalled()
  })

  it("reserves a section slug before creating the section", async () => {
    const reserve = vi.fn().mockResolvedValue({})
    const created = { id: "section-1", slug: "culture", status: "active" }
    const create = vi.fn().mockResolvedValue(created)
    const assign = vi.fn().mockResolvedValue({})
    const createAudit = vi.fn().mockResolvedValue({})
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        sectionSlugHistory: { create: reserve, update: assign },
        section: { create },
        auditLog: { create: createAudit }
      })
    )

    await expect(
      createSection({ $transaction: transaction } as never, {
        input: { name: "Культура", nameEn: "Culture", slug: " Culture ", order: 1 },
        actor: actor("admin"),
        requestId: "request-1"
      })
    ).resolves.toEqual(created)
    expect(reserve).toHaveBeenCalledWith({ data: { slug: "culture" } })
    expect(assign).toHaveBeenCalledWith({
      where: { slug: "culture" },
      data: { ownerSectionId: "section-1", redirectToSectionId: "section-1" }
    })
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "section.update",
        entityType: "Section",
        entityId: "section-1",
        actorId: "admin-1",
        requestId: "request-1"
      })
    })
  })

  it("does not let an author rename a tag", async () => {
    const transaction = vi.fn()
    await expect(
      updateTag({ $transaction: transaction } as never, {
        tagId: "tag-1",
        input: { slug: "renamed" },
        actor: actor("author"),
        requestId: "request-1"
      })
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } })
    expect(transaction).not.toHaveBeenCalled()
  })

  it.each([archiveTag, mergeTags])("does not let an author perform an editorial tag operation", async (operation) => {
    const transaction = vi.fn()

    await expect(
      operation(
        { $transaction: transaction } as never,
        {
          tagId: "source",
          sourceTagIds: ["source"],
          targetTagId: "target",
          actor: actor("author"),
          requestId: "request-1"
        } as never
      )
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } })
    expect(transaction).not.toHaveBeenCalled()
  })

  it("creates a format and its audit entry in one transaction", async () => {
    const format = { id: "format-1", name: "Интервью", slug: "interview", status: "active" }
    const create = vi.fn().mockResolvedValue(format)
    const createAudit = vi.fn().mockResolvedValue({})
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({ format: { create }, auditLog: { create: createAudit } })
    )

    await expect(
      createFormat({ $transaction: transaction } as never, {
        input: { name: "Интервью", nameEn: "Interview", slug: " Interview " },
        actor: actor("admin"),
        requestId: "request-2"
      })
    ).resolves.toEqual(format)

    expect(create).toHaveBeenCalledWith({
      data: { name: "Интервью", nameEn: "Interview", slug: "interview" }
    })
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "format.update",
        actorId: "admin-1",
        entityType: "Format",
        entityId: "format-1",
        requestId: "request-2"
      })
    })
  })

  it("archives a format without removing it from existing articles", async () => {
    const archived = { id: "format-1", status: "archived" }
    const update = vi.fn().mockResolvedValue(archived)
    const createAudit = vi.fn().mockResolvedValue({})
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        format: { findUnique: vi.fn().mockResolvedValue({ status: "active" }), update },
        auditLog: { create: createAudit }
      })
    )

    await expect(
      archiveFormat({ $transaction: transaction } as never, {
        formatId: "format-1",
        actor: actor("owner"),
        requestId: "request-3"
      })
    ).resolves.toEqual(archived)

    expect(update).toHaveBeenCalledWith({
      where: { id: "format-1" },
      data: { status: "archived", archivedAt: expect.any(Date) }
    })
  })

  it("records JSON-safe format fields before and after an update", async () => {
    const before = {
      name: "Интервью",
      nameEn: "Interview",
      slug: "interview",
      description: null,
      descriptionEn: null,
      status: "active"
    }
    const findUnique = vi.fn().mockResolvedValue(before)
    const update = vi.fn().mockResolvedValue({ id: "format-1", ...before, name: "Беседа" })
    const createAudit = vi.fn().mockResolvedValue({})
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({ format: { findUnique, update }, auditLog: { create: createAudit } })
    )

    await updateFormat({ $transaction: transaction } as never, {
      formatId: "format-1",
      input: { name: "Беседа" },
      actor: actor("admin"),
      requestId: "request-4"
    })

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "format-1" },
      select: {
        name: true,
        nameEn: true,
        slug: true,
        description: true,
        descriptionEn: true,
        status: true
      }
    })
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({ diff: { before, after: { name: "Беседа" } } })
    })
  })

  it("restores a format and records the status change", async () => {
    const restored = { id: "format-1", status: "active", archivedAt: null }
    const update = vi.fn().mockResolvedValue(restored)
    const createAudit = vi.fn().mockResolvedValue({})
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        format: { findUnique: vi.fn().mockResolvedValue({ status: "archived" }), update },
        auditLog: { create: createAudit }
      })
    )

    await expect(
      restoreFormat({ $transaction: transaction } as never, {
        formatId: "format-1",
        actor: actor("owner"),
        requestId: "request-5"
      })
    ).resolves.toEqual(restored)
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "format.update",
        diff: { status: { before: "archived", after: "active" } }
      })
    })
  })

  it("does not let an author create a format", async () => {
    const transaction = vi.fn()

    await expect(
      createFormat({ $transaction: transaction } as never, {
        input: { name: "Интервью", nameEn: "Interview", slug: "interview" },
        actor: actor("author"),
        requestId: "request-4"
      })
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } })
    expect(transaction).not.toHaveBeenCalled()
  })

  it("records section fields before and after an update without leaking the version", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue({ name: "Старое", slug: "old", order: 1, updatedAt: new Date("2026-09-26T10:00:00.000Z") })
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const findUniqueOrThrow = vi.fn().mockResolvedValue({ id: "section-1", name: "Новое", slug: "old" })
    const createAudit = vi.fn().mockResolvedValue({})
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        section: { findUnique, updateMany, findUniqueOrThrow },
        sectionSlugHistory: {},
        auditLog: { create: createAudit }
      })
    )

    await updateSection({ $transaction: transaction } as never, {
      sectionId: "section-1",
      input: { name: "Новое" },
      actor: actor("admin"),
      requestId: "request-5"
    })

    // Без заявленной версии запись не привязана к `updatedAt`, а метка не попадает в `diff`.
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "section-1" }, data: { name: "Новое" } })
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "section.update",
        entityId: "section-1",
        requestId: "request-5",
        diff: { before: { name: "Старое", slug: "old", order: 1 }, after: { name: "Новое" } }
      })
    })
  })

  it("records section restoration in the audit journal", async () => {
    const update = vi.fn().mockResolvedValue({ id: "section-1", slug: "culture", status: "active" })
    const createAudit = vi.fn().mockResolvedValue({})
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $queryRaw: vi.fn(),
        sectionSlugHistory: { updateMany: vi.fn() },
        section: {
          findUnique: vi.fn().mockResolvedValue({ status: "archived", archivedByRole: "admin" }),
          update
        },
        auditLog: { create: createAudit }
      })
    )

    await restoreSection({ $transaction: transaction } as never, {
      sectionId: "section-1",
      actor: actor("owner"),
      requestId: "request-6"
    })

    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "section.restore", entityId: "section-1", requestId: "request-6" })
    })
  })
  // T-132 AC-1: иерархия восстановления рубрик повторяет правило тегов (журнал #2, §5).
  it("does not let an admin restore a section archived by the owner", async () => {
    const update = vi.fn()
    const updateHistory = vi.fn()
    const createAudit = vi.fn()
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $queryRaw: vi.fn(),
        sectionSlugHistory: { updateMany: updateHistory },
        section: {
          findUnique: vi.fn().mockResolvedValue({ status: "archived", archivedByRole: "owner" }),
          update
        },
        auditLog: { create: createAudit }
      })
    )

    await expect(
      restoreSection({ $transaction: transaction } as never, {
        sectionId: "section-1",
        actor: actor("admin"),
        requestId: "request-forbidden"
      })
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN", action: "section.restore" } })

    expect(updateHistory).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(createAudit).not.toHaveBeenCalled()
  })

  it("lets the owner restore a section archived by the owner", async () => {
    const restored = { id: "section-1", slug: "culture", status: "active" }
    const update = vi.fn().mockResolvedValue(restored)
    const createAudit = vi.fn().mockResolvedValue({})
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $queryRaw: vi.fn(),
        sectionSlugHistory: { updateMany: vi.fn() },
        section: {
          findUnique: vi.fn().mockResolvedValue({ status: "archived", archivedByRole: "owner" }),
          update
        },
        auditLog: { create: createAudit }
      })
    )

    await expect(
      restoreSection({ $transaction: transaction } as never, {
        sectionId: "section-1",
        actor: actor("owner"),
        requestId: "request-owner-restore"
      })
    ).resolves.toEqual(restored)
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "section.restore", entityId: "section-1" })
    })
  })

  it("does not restore an active section and writes no audit entry", async () => {
    const update = vi.fn()
    const updateHistory = vi.fn()
    const createAudit = vi.fn()
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $queryRaw: vi.fn(),
        sectionSlugHistory: { updateMany: updateHistory },
        section: {
          findUnique: vi.fn().mockResolvedValue({ status: "active", archivedByRole: null }),
          update
        },
        auditLog: { create: createAudit }
      })
    )

    await expect(
      restoreSection({ $transaction: transaction } as never, {
        sectionId: "section-1",
        actor: actor("admin"),
        requestId: "request-active-restore"
      })
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT", expected: "archived section", actual: "active" } })

    expect(updateHistory).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(createAudit).not.toHaveBeenCalled()
  })

  it("reports a missing section as NOT_FOUND instead of a Prisma failure", async () => {
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $queryRaw: vi.fn(),
        sectionSlugHistory: { updateMany: vi.fn() },
        section: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
        auditLog: { create: vi.fn() }
      })
    )

    await expect(
      restoreSection({ $transaction: transaction } as never, {
        sectionId: "missing",
        actor: actor("owner"),
        requestId: "request-missing"
      })
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND", entity: "section" } })
  })

  // T-132 AC-2: правка сверяет версию карточки и не переписывает чужую (§9 «Конфликт»).
  it("refuses a section edit that was prepared against an older version", async () => {
    const updateMany = vi.fn()
    const createAudit = vi.fn()
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        section: {
          findUnique: vi.fn().mockResolvedValue({ name: "Старое", updatedAt: new Date("2026-09-26T12:00:00.000Z") }),
          updateMany,
          findUniqueOrThrow: vi.fn()
        },
        sectionSlugHistory: {},
        auditLog: { create: createAudit }
      })
    )

    await expect(
      updateSection({ $transaction: transaction } as never, {
        sectionId: "section-1",
        input: { name: "Новое" },
        expectedUpdatedAt: "2026-09-26T11:00:00.000Z",
        actor: actor("admin"),
        requestId: "request-stale"
      })
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT", entity: "section", actual: "changed" } })

    expect(updateMany).not.toHaveBeenCalled()
    expect(createAudit).not.toHaveBeenCalled()
  })

  it("keeps the version in the UPDATE so a parallel edit cannot slip through", async () => {
    const version = new Date("2026-09-26T12:00:00.000Z")
    // Оба сотрудника прочитали одну версию; первый успел записать между чтением и записью второго.
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const createAudit = vi.fn()
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        section: {
          findUnique: vi.fn().mockResolvedValue({ name: "Старое", updatedAt: version }),
          updateMany,
          findUniqueOrThrow: vi.fn()
        },
        sectionSlugHistory: {},
        auditLog: { create: createAudit }
      })
    )

    await expect(
      updateSection({ $transaction: transaction } as never, {
        sectionId: "section-1",
        input: { name: "Новое" },
        expectedUpdatedAt: version.toISOString(),
        actor: actor("admin"),
        requestId: "request-parallel"
      })
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT", expected: version.toISOString() } })

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "section-1", updatedAt: version },
      data: { name: "Новое" }
    })
    expect(createAudit).not.toHaveBeenCalled()
  })

  it.each([
    ["archiveFormat", archiveFormat, "archived", "active"],
    ["restoreFormat", restoreFormat, "active", "archived"]
  ])("%s refuses a format that is already in the target state", async (_name, operation, current, expected) => {
    const update = vi.fn()
    const createAudit = vi.fn()
    const transaction = vi.fn(async (op: (tx: unknown) => Promise<unknown>) =>
      op({
        format: { findUnique: vi.fn().mockResolvedValue({ status: current }), update },
        auditLog: { create: createAudit }
      })
    )

    await expect(
      operation({ $transaction: transaction } as never, {
        formatId: "format-1",
        actor: actor("admin"),
        requestId: "request-format-status"
      })
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT", entity: "format", expected, actual: current } })

    expect(update).not.toHaveBeenCalled()
    expect(createAudit).not.toHaveBeenCalled()
  })

  it("moves tag links, redirects source slugs and records tag.merge for each source", async () => {
    const executeRaw = vi
      .fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
    const updateHistory = vi.fn().mockResolvedValue({ count: 2 })
    const updateTags = vi.fn().mockResolvedValue({ count: 2 })
    const createAudit = vi.fn().mockResolvedValue({})
    const target = { id: "target", slug: "cinema" }
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $queryRaw: vi.fn().mockResolvedValue([
          { id: "source-a", status: "active" },
          { id: "source-b", status: "archived" },
          { id: "target", status: "active" }
        ]),
        $executeRaw: executeRaw,
        tagSlugHistory: { updateMany: updateHistory },
        tag: { updateMany: updateTags, findUnique: vi.fn().mockResolvedValue(target) },
        auditLog: { create: createAudit }
      })
    )

    await expect(
      mergeTags({ $transaction: transaction } as never, {
        sourceTagIds: ["source-a", "source-b"],
        targetTagId: "target",
        actor: actor("admin"),
        requestId: "request-7"
      })
    ).resolves.toEqual(target)

    expect(updateHistory).toHaveBeenCalledWith({
      where: { ownerTagId: { in: ["source-a", "source-b"] } },
      data: { redirectToTagId: "target" }
    })
    expect(updateTags).toHaveBeenCalledWith({
      where: { id: { in: ["source-a", "source-b"] } },
      data: expect.objectContaining({ status: "archived", mergedIntoId: "target" })
    })
    expect(createAudit).toHaveBeenCalledTimes(2)
    expect(createAudit).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        action: "tag.merge",
        entityType: "Tag",
        entityId: "source-a",
        diff: { sourceTagIds: ["source-a", "source-b"], targetTagId: "target", movedArticles: 2 },
        requestId: "request-7"
      })
    })
    expect(createAudit).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        entityId: "source-b",
        diff: { sourceTagIds: ["source-a", "source-b"], targetTagId: "target", movedArticles: 0 }
      })
    })
  })

  it("records tag.archive with the number of linked articles and drops the redirect", async () => {
    const updateHistory = vi.fn().mockResolvedValue({ count: 1 })
    const update = vi.fn().mockResolvedValue({ id: "tag-1", status: "archived" })
    const createAudit = vi.fn().mockResolvedValue({})
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $queryRaw: vi.fn().mockResolvedValue([{ id: "tag-1" }]),
        tag: {
          findUnique: vi.fn().mockResolvedValue({ status: "active", _count: { articles: 4 } }),
          update
        },
        tagSlugHistory: { updateMany: updateHistory },
        auditLog: { create: createAudit }
      })
    )

    await expect(
      archiveTag({ $transaction: transaction } as never, {
        tagId: "tag-1",
        actor: actor("admin"),
        requestId: "request-8"
      })
    ).resolves.toEqual({ id: "tag-1", status: "archived" })

    expect(updateHistory).toHaveBeenCalledWith({ where: { ownerTagId: "tag-1" }, data: { redirectToTagId: null } })
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "tag.archive",
        entityType: "Tag",
        entityId: "tag-1",
        diff: { articles: 4 },
        requestId: "request-8"
      })
    })
  })

  it("does not archive a tag that is already archived", async () => {
    const update = vi.fn()
    const createAudit = vi.fn()
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $queryRaw: vi.fn().mockResolvedValue([{ id: "tag-1" }]),
        tag: {
          findUnique: vi.fn().mockResolvedValue({ status: "archived", _count: { articles: 0 } }),
          update
        },
        tagSlugHistory: { updateMany: vi.fn() },
        auditLog: { create: createAudit }
      })
    )

    await expect(
      archiveTag({ $transaction: transaction } as never, {
        tagId: "tag-1",
        actor: actor("admin"),
        requestId: "request-9"
      })
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } })

    expect(update).not.toHaveBeenCalled()
    expect(createAudit).not.toHaveBeenCalled()
  })

  it("refuses to restore a merged tag", async () => {
    const update = vi.fn()
    const updateHistory = vi.fn()
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $queryRaw: vi.fn().mockResolvedValue([{ id: "tag-1" }]),
        tag: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ status: "archived", mergedIntoId: "target", archivedByRole: "admin" }),
          update
        },
        tagSlugHistory: { updateMany: updateHistory },
        auditLog: { create: vi.fn() }
      })
    )

    await expect(
      restoreTag({ $transaction: transaction } as never, {
        tagId: "tag-1",
        actor: actor("owner"),
        requestId: "request-10"
      })
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } })

    expect(updateHistory).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it("does not let an admin restore an archive made by the owner", async () => {
    const update = vi.fn()
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $queryRaw: vi.fn().mockResolvedValue([{ id: "tag-1" }]),
        tag: {
          findUnique: vi.fn().mockResolvedValue({ status: "archived", mergedIntoId: null, archivedByRole: "owner" }),
          update
        },
        tagSlugHistory: { updateMany: vi.fn() },
        auditLog: { create: vi.fn() }
      })
    )

    await expect(
      restoreTag({ $transaction: transaction } as never, {
        tagId: "tag-1",
        actor: actor("admin"),
        requestId: "request-11"
      })
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } })

    expect(update).not.toHaveBeenCalled()
  })

  it("restores an archived tag, returns its redirect and records tag.restore", async () => {
    const updateHistory = vi.fn().mockResolvedValue({ count: 1 })
    const update = vi.fn().mockResolvedValue({ id: "tag-1", status: "active" })
    const createAudit = vi.fn().mockResolvedValue({})
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $queryRaw: vi.fn().mockResolvedValue([{ id: "tag-1" }]),
        tag: {
          findUnique: vi.fn().mockResolvedValue({ status: "archived", mergedIntoId: null, archivedByRole: "admin" }),
          update
        },
        tagSlugHistory: { updateMany: updateHistory },
        auditLog: { create: createAudit }
      })
    )

    await expect(
      restoreTag({ $transaction: transaction } as never, {
        tagId: "tag-1",
        actor: actor("admin"),
        requestId: "request-12"
      })
    ).resolves.toEqual({ id: "tag-1", status: "active" })

    expect(updateHistory).toHaveBeenCalledWith({ where: { ownerTagId: "tag-1" }, data: { redirectToTagId: "tag-1" } })
    expect(update).toHaveBeenCalledWith({
      where: { id: "tag-1" },
      data: { status: "active", archivedAt: null, archivedByActorId: null, archivedByRole: null }
    })
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "tag.restore", entityType: "Tag", entityId: "tag-1" })
    })
  })
})
