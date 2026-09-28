import { describe, expect, it } from "vitest"
import { parseUserFilters } from "../app/composables/useAdminUsers"
import { canManageUsers, canReadUsers } from "../app/utils/admin"

/**
 * T-073: фильтры раздела «Пользователи» живут в адресе (`docs/spec/40-admin/users.md` §4), а доступ
 * к разделу и его действиям идёт по роли (матрица #81 на чтение, #52/#80/#105/#113 на действия).
 */

describe("фильтры раздела в адресе", () => {
  it("по умолчанию показывает активные записи в порядке регистрации", () => {
    expect(parseUserFilters({})).toEqual({
      role: null,
      status: "active",
      archiveMode: null,
      plan: null,
      registeredFrom: null,
      registeredTo: null,
      lastActiveFrom: null,
      hasPublications: null,
      search: null,
      sort: "registered"
    })
  })

  it("читает роль, статус, режим архива, план, публикации, поиск и сортировку", () => {
    expect(
      parseUserFilters({
        role: "author",
        status: "archived",
        mode: "emergency",
        plan: "grant",
        published: "yes",
        q: "  вера  ",
        sort: "lastActive",
        registeredFrom: "2026-09-01",
        lastActiveFrom: "2026-09-20"
      })
    ).toMatchObject({
      role: "author",
      status: "archived",
      archiveMode: "emergency",
      plan: "grant",
      hasPublications: true,
      search: "вера",
      sort: "lastActive",
      registeredFrom: "2026-09-01",
      lastActiveFrom: "2026-09-20"
    })
  })

  it("различает «без публикаций» и «не важно»", () => {
    expect(parseUserFilters({ published: "no" }).hasPublications).toBe(false)
    expect(parseUserFilters({ published: "maybe" }).hasPublications).toBeNull()
  })

  it("игнорирует служебные роли и неизвестные значения", () => {
    expect(parseUserFilters({ role: "admin", plan: "platinum", sort: "random", status: "deleted" })).toMatchObject({
      role: null,
      plan: null,
      sort: "registered",
      status: "active"
    })
  })
})

describe("доступ к разделу по роли", () => {
  it("читают аналитик, администратор и владелец", () => {
    expect(["analyst", "admin", "owner"].map(canReadUsers)).toEqual([true, true, true])
    expect(["reader", "author", "editor", "moderator"].map(canReadUsers)).toEqual([false, false, false, false])
  })

  it("действия доступны администратору и владельцу; аналитик читает без действий", () => {
    expect(["admin", "owner"].map(canManageUsers)).toEqual([true, true])
    expect(canManageUsers("analyst")).toBe(false)
  })
})
