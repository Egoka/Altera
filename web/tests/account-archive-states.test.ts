import { describe, expect, it } from "vitest"
import {
  accountArchiveErrorKind,
  accountRestoreErrorKind,
  isArchiveRequestExpired,
  isConfirmationWord
} from "../app/utils/accountArchive"

// Разбор кодов ошибок в строки §8 двух страниц: docs/spec/30-account/reader/delete-account.md
// и archived-state.md. Коды — ADR-0032.

describe("accountArchiveErrorKind", () => {
  it("различает два CONFLICT: последний владелец и уже открытый запрос", () => {
    expect(accountArchiveErrorKind({ code: "CONFLICT", entity: "user", actual: "last owner" })).toBe("lastOwner")
    expect(accountArchiveErrorKind({ code: "CONFLICT", entity: "accountArchive" })).toBe("openRequest")
  })

  it("CONFLICT без известной причины остаётся общей строкой, а не выдумывает свою", () => {
    expect(accountArchiveErrorKind({ code: "CONFLICT", entity: "user", actual: "archived" })).toBe("generic")
  })

  it("называет лимит и отказ почты отдельными строками", () => {
    expect(accountArchiveErrorKind({ code: "RATE_LIMITED" })).toBe("rateLimited")
    expect(accountArchiveErrorKind({ code: "PROVIDER_UNAVAILABLE" })).toBe("providerUnavailable")
  })
})

describe("accountRestoreErrorKind", () => {
  it("различает административный архив и уже восстановленный аккаунт", () => {
    expect(accountRestoreErrorKind("FORBIDDEN")).toBe("forbidden")
    expect(accountRestoreErrorKind("CONFLICT")).toBe("conflict")
    expect(accountRestoreErrorKind("INTERNAL_ERROR")).toBe("generic")
  })
})

describe("isArchiveRequestExpired", () => {
  const now = new Date("2026-09-27T10:00:00.000Z")

  it("считает истёкшей ссылку с прошедшим сроком", () => {
    expect(isArchiveRequestExpired("2026-09-27T09:59:59.000Z", now)).toBe(true)
    expect(isArchiveRequestExpired("2026-09-27T10:30:00.000Z", now)).toBe(false)
  })

  it("без открытого запроса и с нечитаемым сроком ничего не истекает", () => {
    expect(isArchiveRequestExpired(null, now)).toBe(false)
    expect(isArchiveRequestExpired("не дата", now)).toBe(false)
  })
})

describe("isConfirmationWord", () => {
  it("принимает слово в другом регистре и с пробелами по краям", () => {
    expect(isConfirmationWord("  Удалить ", "удалить")).toBe(true)
    expect(isConfirmationWord("DELETE", "delete")).toBe(true)
  })

  it("не принимает другое слово", () => {
    expect(isConfirmationWord("архивировать", "удалить")).toBe(false)
    expect(isConfirmationWord("", "удалить")).toBe(false)
  })
})
