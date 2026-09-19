import { describe, expect, it, vi } from "vitest"
import { archiveSection, archiveTag, createSection, createTag, mergeTags, updateTag } from "../src/taxonomy/service"

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
    const archived = { id: "source", status: "archived", successorId: "target", slug: "culture" }
    const updateSection = vi.fn().mockResolvedValue(archived)
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $queryRaw: vi.fn().mockResolvedValue([
          { id: "source", status: "active" },
          { id: "target", status: "active" }
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

  it("reserves a section slug before creating the section", async () => {
    const reserve = vi.fn().mockResolvedValue({})
    const created = { id: "section-1", slug: "culture", status: "active" }
    const create = vi.fn().mockResolvedValue(created)
    const assign = vi.fn().mockResolvedValue({})
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        sectionSlugHistory: { create: reserve, update: assign },
        section: { create }
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
})
