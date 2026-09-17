import { describe, expect, it } from "vitest"
import { getArticleRouteState } from "../app/utils/articleRouteVisibility"

describe("article route visibility", () => {
  it("maps ARCHIVED to the gone page even when sibling fields also report NOT_FOUND", () => {
    expect(
      getArticleRouteState({
        data: { article: null },
        errors: [
          { message: "Entity not found", extensions: { code: "NOT_FOUND" } },
          { message: "Entity archived", extensions: { code: "ARCHIVED" } }
        ]
      })
    ).toEqual({ kind: "gone", statusCode: 410 })
  })

  it("maps a hidden draft to a 404 without exposing its status", () => {
    expect(
      getArticleRouteState({
        data: { article: null },
        errors: [{ message: "Entity not found", extensions: { code: "NOT_FOUND" } }]
      })
    ).toEqual({ kind: "error", statusCode: 404, code: "NOT_FOUND", requestId: undefined })
  })

  it("returns a published article as visible", () => {
    const article = { id: "article-1", title: "Visible article" }

    expect(getArticleRouteState({ data: { article } })).toEqual({ kind: "visible", article })
  })

  it("maps an unexpected GraphQL failure to 500 and preserves its request ID", () => {
    expect(
      getArticleRouteState({
        data: { article: null },
        errors: [
          {
            message: "Internal server error",
            extensions: { code: "INTERNAL_ERROR", requestId: "request-500" }
          }
        ]
      })
    ).toEqual({ kind: "error", statusCode: 500, code: "INTERNAL_ERROR", requestId: "request-500" })
  })
})
