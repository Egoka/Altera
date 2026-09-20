import { describe, expect, it, vi } from "vitest"
import {
  errorRequestId,
  feedRequestId,
  pageParam,
  requestLocale,
  stringParam,
  throwOnFeedError,
  withQuery
} from "../app/utils/publicFeed"

// Разбор адреса и отказов публичных лент: `section-feed.md` §8, `tags-index.md` §8.

describe("локаль запроса", () => {
  it("различает только два языка выдачи", () => {
    expect(requestLocale("en")).toBe("en")
    expect(requestLocale("ru")).toBe("ru")
    expect(requestLocale("en-GB")).toBe("ru")
  })
})

describe("номер страницы из адреса", () => {
  it("без параметра — первая страница", () => {
    expect(pageParam(undefined)).toBe(1)
    expect(pageParam("")).toBe(1)
  })

  it("читает число и берёт первое значение повторённого параметра", () => {
    expect(pageParam("3")).toBe(3)
    expect(pageParam(["2", "5"])).toBe(2)
  })

  it("нечисловое значение отдаётся серверу как заведомо неверное, а не как первая страница", () => {
    expect(pageParam("страница")).toBe(-1)
  })
})

describe("строковый параметр адреса", () => {
  it("пустая строка и пробелы считаются отсутствием", () => {
    expect(stringParam("  ")).toBeNull()
    expect(stringParam(undefined)).toBeNull()
    expect(stringParam(" essay ")).toBe("essay")
  })
})

describe("сборка адреса", () => {
  it("не пишет пустые значения и первую страницу", () => {
    expect(withQuery("/tags", { q: null, page: 1 })).toBe("/tags")
  })

  it("сохраняет заданные значения", () => {
    expect(withQuery("/culture", { format: "essay", tag: null, page: 3 })).toBe("/culture?format=essay&page=3")
  })
})

describe("отказ API в состояние страницы", () => {
  const createError = vi.fn((input: object) => Object.assign(new Error("failed"), input))

  it("«не найдено» и неверный параметр дают 404", () => {
    vi.stubGlobal("createError", createError)

    for (const code of ["NOT_FOUND", "VALIDATION_ERROR"]) {
      expect(() => throwOnFeedError({ errors: [{ extensions: { code } }] })).toThrowError()
    }
    expect(createError).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }))
    vi.unstubAllGlobals()
  })

  it("прочий отказ даёт 500 с кодом запроса", () => {
    vi.stubGlobal("createError", createError)
    createError.mockClear()

    expect(() =>
      throwOnFeedError({ errors: [{ extensions: { code: "INTERNAL_ERROR", requestId: "req-1" } }] })
    ).toThrowError()
    expect(createError).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500, data: { requestId: "req-1" } }))
    vi.unstubAllGlobals()
  })

  it("успешный ответ отдаёт данные без ошибки", () => {
    expect(throwOnFeedError({ data: { ok: true } })).toEqual({ ok: true })
  })
})

describe("код запроса", () => {
  it("читается и из отказа GraphQL, и из ошибки страницы", () => {
    expect(feedRequestId([{ extensions: { requestId: "req-2" } }])).toBe("req-2")
    expect(feedRequestId([{ extensions: {} }])).toBeUndefined()
    expect(errorRequestId({ data: { requestId: "req-3" } })).toBe("req-3")
    expect(errorRequestId(null)).toBeUndefined()
  })
})
