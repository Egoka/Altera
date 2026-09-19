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
        input: { name: "Photo story", slug: " Photo-Story " },
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
      operation({ format: { update }, auditLog: { create: createAudit } })
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
      operation({ format: { update }, auditLog: { create: createAudit } })
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

  it("records section fields before and after an update", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "section-1", name: "Старое", slug: "old" })
    const update = vi.fn().mockResolvedValue({ id: "section-1", name: "Новое", slug: "old" })
    const createAudit = vi.fn().mockResolvedValue({})
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({ section: { findUnique, update }, sectionSlugHistory: {}, auditLog: { create: createAudit } })
    )

    await updateSection({ $transaction: transaction } as never, {
      sectionId: "section-1",
      input: { name: "Новое" },
      actor: actor("admin"),
      requestId: "request-5"
    })

    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "section.update", entityId: "section-1", requestId: "request-5" })
    })
  })

  it("records section restoration in the audit journal", async () => {
    const update = vi.fn().mockResolvedValue({ id: "section-1", slug: "culture", status: "active" })
    const createAudit = vi.fn().mockResolvedValue({})
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $queryRaw: vi.fn(),
        sectionSlugHistory: { updateMany: vi.fn() },
        section: { update },
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
})
