import { describe, expect, it } from "vitest"
import { formatArticleDate } from "../app/utils/articleDate"

// Дата в служебной строке карточки набирается по локали страницы: русская лента
// пишет «27 августа 2026», английская — «August 27, 2026». Ключ локали — тот же,
// что у @nuxtjs/i18n (`ru` / `en`).

describe("дата материала по локали", () => {
  it("русская локаль: день, месяц в родительном падеже, год", () => {
    expect(formatArticleDate("2026-08-27T10:00:00Z", "ru")).toBe("27 августа 2026")
  })

  it("английская локаль: месяц, день с запятой, год", () => {
    expect(formatArticleDate("2026-08-27T10:00:00Z", "en")).toBe("August 27, 2026")
  })

  it("неизвестная локаль падает на английскую", () => {
    expect(formatArticleDate("2026-01-05T12:00:00Z", "de")).toBe("January 5, 2026")
  })

  it("пустая или битая дата даёт пустую строку", () => {
    expect(formatArticleDate("", "ru")).toBe("")
    expect(formatArticleDate("не дата", "ru")).toBe("")
  })
})
