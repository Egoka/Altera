import { print } from "graphql"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CreateArticleDocument } from "../app/graphql/generated/graphql"
import { createArticleDraftAndOpenEditor } from "../app/composables/useCreateArticleDraft"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("new article action", () => {
  it("creates an empty draft and opens its editor", async () => {
    const requestFetch = vi.fn().mockResolvedValue({
      data: { createArticle: { id: "article-1", slug: "draft-article-1", title: "" } }
    })
    const navigate = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("useRequestFetch", () => requestFetch)
    vi.stubGlobal("navigateTo", navigate)

    await createArticleDraftAndOpenEditor("section-1")

    expect(requestFetch).toHaveBeenCalledWith("/api/graphql", {
      method: "POST",
      body: {
        query: print(CreateArticleDocument),
        variables: { input: { sectionId: "section-1" } }
      }
    })
    expect(navigate).toHaveBeenCalledWith("/me/articles/article-1/edit", { redirectCode: 302, replace: true })
  })
})
