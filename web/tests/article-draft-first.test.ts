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

  const failWith = (code: string) => {
    const navigate = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("useRequestFetch", () =>
      vi.fn().mockResolvedValue({ data: null, errors: [{ message: "Action forbidden", extensions: { code } }] })
    )
    vi.stubGlobal("navigateTo", navigate)
    vi.stubGlobal("createError", (input: { statusCode: number; statusMessage: string }) =>
      Object.assign(new Error(input.statusMessage), input)
    )
    return navigate
  }

  it.each([
    ["FORBIDDEN", 403],
    ["PLAN_LIMIT", 403],
    ["INTERNAL_ERROR", 500]
  ])("maps %s from createArticle to HTTP %i instead of a generic server error", async (code, statusCode) => {
    const navigate = failWith(code)

    await expect(createArticleDraftAndOpenEditor()).rejects.toMatchObject({ statusCode })
    expect(navigate).not.toHaveBeenCalled()
  })

  it("sends an expired session to login and back to the same action", async () => {
    const navigate = failWith("UNAUTHENTICATED")

    await createArticleDraftAndOpenEditor("section 1")

    expect(navigate).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/me/articles/new?section=section%201")}`, {
      redirectCode: 302,
      replace: true
    })
  })
})
