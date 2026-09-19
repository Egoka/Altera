import { describe, expect, it, vi } from "vitest"
import tagResolver from "../src/graphql/tag/resolver"

describe("tag autocomplete", () => {
  it("returns only active matching tags for an authenticated author", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "tag-1", name: "Photo story", slug: "photo-story" }])
    const ctx = {
      prisma: { tag: { findMany } },
      currentUser: {
        id: "author-1",
        role: "author",
        archivedAt: null,
        planTier: "standard",
        planUntil: new Date("2099-01-01T00:00:00.000Z")
      },
      requestId: "request-1"
    } as never

    await expect(tagResolver.Query.tagAutocomplete(null, { q: " photo ", limit: 8 }, ctx)).resolves.toEqual([
      { id: "tag-1", name: "Photo story", slug: "photo-story" }
    ])
    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: "active",
        OR: [
          { name: { contains: "photo", mode: "insensitive" } },
          { nameEn: { contains: "photo", mode: "insensitive" } },
          { slug: { contains: "photo", mode: "insensitive" } }
        ]
      },
      orderBy: { name: "asc" },
      take: 8
    })
  })
})
