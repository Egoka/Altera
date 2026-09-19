import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import tagResolver from "../src/graphql/tag/resolver"

const author = {
  id: "author-1",
  role: "author",
  archivedAt: null,
  planTier: "standard",
  planUntil: new Date("2099-01-01T00:00:00.000Z")
}

const context = (findMany: ReturnType<typeof vi.fn>, currentUser: object | null = author) =>
  ({ prisma: { tag: { findMany } }, currentUser, requestId: "request-1" }) as never

const matching = (operator: "startsWith" | "contains", value: string) => [
  { name: { [operator]: value, mode: "insensitive" } },
  { nameEn: { [operator]: value, mode: "insensitive" } },
  { slug: { [operator]: value, mode: "insensitive" } }
]

describe("tag autocomplete", () => {
  it("returns prefix matches before other active matches so an exact tag is not cut off", async () => {
    const go = { id: "tag-go", name: "Go", slug: "go" }
    const golang = { id: "tag-golang", name: "Golang", slug: "golang" }
    const cargo = { id: "tag-cargo", name: "Cargo", slug: "cargo" }
    const findMany = vi.fn().mockResolvedValueOnce([go, golang]).mockResolvedValueOnce([cargo])

    await expect(tagResolver.Query.tagAutocomplete(null, { q: " go ", limit: 3 }, context(findMany))).resolves.toEqual([
      go,
      golang,
      cargo
    ])
    expect(findMany).toHaveBeenNthCalledWith(1, {
      where: { status: "active", OR: matching("startsWith", "go") },
      orderBy: { name: "asc" },
      take: 3
    })
    expect(findMany).toHaveBeenNthCalledWith(2, {
      where: { status: "active", id: { notIn: ["tag-go", "tag-golang"] }, OR: matching("contains", "go") },
      orderBy: { name: "asc" },
      take: 1
    })
  })

  it("skips the substring query when prefix matches fill the limit", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "tag-1" }, { id: "tag-2" }])

    await tagResolver.Query.tagAutocomplete(null, { q: "photo", limit: 2 }, context(findMany))

    expect(findMany).toHaveBeenCalledTimes(1)
  })

  it("treats an explicit null limit as the default instead of passing it to Prisma", async () => {
    const findMany = vi.fn().mockResolvedValue([])

    await tagResolver.Query.tagAutocomplete(null, { q: "photo", limit: null }, context(findMany))

    expect(findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ take: 10 }))
    expect(findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ take: 10 }))
  })

  it.each([
    [{ q: " p ", limit: 10 }, "q", "minLength:2"],
    [{ q: "photo", limit: 0 }, "limit", "range:1-20"],
    [{ q: "photo", limit: 21 }, "limit", "range:1-20"]
  ])("rejects %j with a validation error", async (args, field, rule) => {
    const findMany = vi.fn()

    await expect(tagResolver.Query.tagAutocomplete(null, args, context(findMany))).rejects.toMatchObject<
      Partial<GraphQLError>
    >({ extensions: { code: "VALIDATION_ERROR", field, rule } })
    expect(findMany).not.toHaveBeenCalled()
  })

  it("requires authentication", async () => {
    const findMany = vi.fn()

    await expect(
      tagResolver.Query.tagAutocomplete(null, { q: "photo" }, context(findMany, null))
    ).rejects.toMatchObject<Partial<GraphQLError>>({ extensions: { code: "UNAUTHENTICATED" } })
    expect(findMany).not.toHaveBeenCalled()
  })
})
