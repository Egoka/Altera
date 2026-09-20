import { describe, expect, it } from "vitest"
import { readStaffFilters, staffFiltersToQuery } from "../app/utils/adminStaffFilters"

// Фильтры раздела «Администраторы» сохраняются в адресе (`docs/spec/40-admin/admins.md` п. 4).

describe("фильтры служебных записей в адресе", () => {
  it("читает роль, статус, исключения, срок и поиск", () => {
    expect(
      readStaffFilters({ role: "admin", status: "archived", exceptions: "1", term: "expiring", q: " мар " })
    ).toEqual({
      role: "admin",
      status: "archived",
      hasExceptions: true,
      term: "expiring",
      search: "мар"
    })
  })

  it("по умолчанию показывает активные записи", () => {
    expect(readStaffFilters({})).toEqual({
      role: null,
      status: "active",
      hasExceptions: null,
      term: null,
      search: null
    })
  })

  it("игнорирует неизвестные значения роли и срока", () => {
    expect(readStaffFilters({ role: "reader", term: "forever" })).toMatchObject({ role: null, term: null })
  })

  it("возвращает в адрес только заданные фильтры", () => {
    expect(staffFiltersToQuery(readStaffFilters({}))).toEqual({})
    expect(
      staffFiltersToQuery({
        role: "editor",
        status: "archived",
        hasExceptions: true,
        term: "indefinite",
        search: "мар"
      })
    ).toEqual({ role: "editor", status: "archived", exceptions: "1", term: "indefinite", q: "мар" })
  })
})
