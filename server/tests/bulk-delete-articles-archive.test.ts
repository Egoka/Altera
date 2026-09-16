import { describe, expect, it, vi } from "vitest"
import articleResolver from "../src/graphql/article/resolver"

// AC-T053-2 (ALTE-34): адрес удалённого материала не может быть выдан другому. До задачи T-076
// («удалить навсегда», владелец, из архива) в продукте нет пути физически удалить строку Article —
// bulkDeleteArticles архивирует материал так же, как archiveArticle и taxonomy/service.ts делают
// для секций и тегов, оставляя уникальный slug занятым навсегда.

const ARTICLE_1_ID = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa"
const ARTICLE_2_ID = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb"

describe("bulkDeleteArticles", () => {
  it("архивирует статьи вместо физического удаления и сохраняет slug занятым", async () => {
    const existingArticles = [
      { id: ARTICLE_1_ID, slug: "first-article", status: "published" },
      { id: ARTICLE_2_ID, slug: "second-article", status: "draft" }
    ]
    const archivedArticles = existingArticles.map((article) => ({
      ...article,
      status: "archived",
      archivedAt: new Date("2026-09-17T00:00:00.000Z"),
      archivedByActorId: "admin-1",
      archivedByRole: "admin",
      archiveReason: "bulk_delete"
    }))

    const findMany = vi.fn().mockResolvedValueOnce(existingArticles).mockResolvedValueOnce(archivedArticles)
    const updateMany = vi.fn().mockResolvedValue({ count: existingArticles.length })
    const delByTags = vi.fn().mockResolvedValue(undefined)

    const ctx = {
      currentUser: { id: "admin-1", role: "admin" },
      requestId: "req-bulk-delete",
      prisma: { article: { findMany, updateMany } },
      cache: { delByTags }
    }

    const result = await articleResolver.Mutation.bulkDeleteArticles(
      {},
      { ids: [ARTICLE_1_ID, ARTICLE_2_ID] },
      ctx as never
    )

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: [ARTICLE_1_ID, ARTICLE_2_ID] } },
      data: {
        status: "archived",
        archivedAt: expect.any(Date),
        archivedByActorId: "admin-1",
        archivedByRole: "admin",
        archiveReason: "bulk_delete"
      }
    })
    expect(result).toEqual(archivedArticles)
    expect(delByTags).toHaveBeenCalled()
  })

  it("не вызывает физическое удаление строки (deleteMany недоступен в контексте)", async () => {
    const existingArticles = [{ id: ARTICLE_1_ID, slug: "first-article", status: "published" }]

    const ctx = {
      currentUser: { id: "admin-1", role: "admin" },
      requestId: "req-bulk-delete-no-hard-delete",
      prisma: {
        article: {
          findMany: vi.fn().mockResolvedValue(existingArticles),
          updateMany: vi.fn().mockResolvedValue({ count: 1 })
          // deleteMany намеренно отсутствует: если резолвер вызовет его, тест упадёт с TypeError.
        }
      },
      cache: { delByTags: vi.fn().mockResolvedValue(undefined) }
    }

    await expect(
      articleResolver.Mutation.bulkDeleteArticles({}, { ids: [ARTICLE_1_ID] }, ctx as never)
    ).resolves.toBeDefined()
  })
})
