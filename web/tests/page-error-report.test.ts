import { describe, expect, it, vi } from "vitest"
import { createPageErrorReporter, pageErrorReport, RENDER_ERROR_CODE } from "~/utils/pageErrorReport"

/**
 * T-089: ошибка фронта `page.error` уходит в историю ошибок через мутацию `reportPageError`
 * (реестр событий #64, `80-observability/error-collector.md` §2 п. 1, §3).
 */

const REQUEST_ID = "5f0c2a4e-8b1d-4c3e-9a7f-1b2c3d4e5f60"
const articleRoute = { matched: [{ path: "/" }, { path: "/articles/:slug()" }] }

describe("pageErrorReport", () => {
  it("reports a server failure with the route template and the requestId of the failure", () => {
    expect(pageErrorReport({ statusCode: 502, data: { requestId: REQUEST_ID } }, articleRoute)).toEqual({
      route: "/articles/:slug()",
      code: "502",
      requestId: REQUEST_ID
    })
  })

  it("reports a render error without a status and falls back to the page requestId", () => {
    expect(pageErrorReport(new TypeError("x is undefined"), articleRoute, REQUEST_ID)).toEqual({
      route: "/articles/:slug()",
      code: RENDER_ERROR_CODE,
      requestId: REQUEST_ID
    })
  })

  it("does not report expected page states and unmatched routes", () => {
    for (const statusCode of [400, 403, 404, 410]) {
      expect(pageErrorReport({ statusCode }, articleRoute)).toBeNull()
    }
    expect(pageErrorReport({ statusCode: 500 }, { matched: [] })).toBeNull()
  })
})

describe("createPageErrorReporter", () => {
  it("sends the ReportPageError mutation once per distinct error", async () => {
    const post = vi.fn(async () => ({ data: { reportPageError: true } }))
    const report = createPageErrorReporter(post)
    const pageError = pageErrorReport({ statusCode: 500 }, articleRoute, REQUEST_ID)

    await expect(report(pageError)).resolves.toBe(true)
    await expect(report(pageError)).resolves.toBe(false)
    await expect(report(null)).resolves.toBe(false)

    expect(post).toHaveBeenCalledTimes(1)
    const [url, options] = post.mock.calls[0] as unknown as [string, { method: string; body: Record<string, unknown> }]
    expect(url).toBe("/api/graphql")
    expect(options.method).toBe("POST")
    expect(options.body.query).toContain("mutation ReportPageError")
    expect(options.body.variables).toEqual({ route: "/articles/:slug()", code: "500", requestId: REQUEST_ID })
  })

  it("swallows a failed delivery so reporting cannot raise a new page error", async () => {
    const report = createPageErrorReporter(async () => {
      throw new Error("offline")
    })

    await expect(report({ route: "/feed", code: RENDER_ERROR_CODE, requestId: null })).resolves.toBe(false)
  })
})
