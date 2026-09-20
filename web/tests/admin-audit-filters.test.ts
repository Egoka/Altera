import { describe, expect, it } from "vitest"
import { auditEntityLink, auditPeriodRange, buildAuditQuery, parseAuditQuery, toAuditFilters } from "../app/utils/audit"

const NOW = new Date("2026-09-20T12:00:00.000Z")

describe("фильтры аудита в адресе страницы", () => {
  it("по умолчанию берёт свою зону, период 7 дней и пустые фильтры", () => {
    const state = parseAuditQuery({})

    expect(state).toEqual({
      zone: null,
      action: "",
      actor: "",
      system: false,
      entityType: "",
      entityId: "",
      subject: "",
      requestId: "",
      period: "7d",
      entryId: ""
    })
    expect(buildAuditQuery(state)).toEqual({})
  })

  it("разбирает все фильтры спецификации из запроса", () => {
    const state = parseAuditQuery({
      zone: "financeAndPd",
      action: "admin.read.personal",
      actor: "analyst-1",
      entity: "user:user-42",
      subject: "user-42",
      requestId: "req-7",
      period: "2026-09-01..2026-09-19",
      id: "audit-1"
    })

    expect(state).toMatchObject({
      zone: "financeAndPd",
      action: "admin.read.personal",
      actor: "analyst-1",
      system: false,
      entityType: "user",
      entityId: "user-42",
      subject: "user-42",
      requestId: "req-7",
      period: "2026-09-01..2026-09-19",
      entryId: "audit-1"
    })
  })

  it("сохраняет фильтры обратно в адрес без пустых значений", () => {
    const state = parseAuditQuery({ zone: "moderation", entity: "article:a-1", period: "30d", id: "audit-9" })

    expect(buildAuditQuery(state)).toEqual({
      zone: "moderation",
      entity: "article:a-1",
      period: "30d",
      id: "audit-9"
    })
  })

  it("распознаёт «систему» как актора и отбрасывает неизвестную зону", () => {
    const state = parseAuditQuery({ actor: "system", zone: "unknown" })

    expect(state.system).toBe(true)
    expect(state.zone).toBeNull()
    expect(buildAuditQuery(state).actor).toBe("system")
    expect(toAuditFilters(state, NOW)).toMatchObject({ actorSystem: true, actorId: null })
  })

  it("считает период из пресета и из диапазона дат", () => {
    expect(auditPeriodRange("7d", NOW)).toEqual({ from: "2026-09-13T12:00:00.000Z", to: null })
    expect(auditPeriodRange("30d", NOW)).toEqual({ from: "2026-08-21T12:00:00.000Z", to: null })
    expect(auditPeriodRange("2026-09-01..2026-09-19", NOW)).toEqual({
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-19T23:59:59.999Z"
    })
  })

  it("переносит состояние в фильтры запроса", () => {
    const state = parseAuditQuery({ action: "stats.export", actor: "admin-1", entity: "auditLog:export" })

    expect(toAuditFilters(state, NOW)).toEqual({
      zone: null,
      action: "stats.export",
      actorId: "admin-1",
      actorSystem: null,
      entityType: "auditLog",
      entityId: "export",
      subject: null,
      requestId: null,
      from: "2026-09-13T12:00:00.000Z",
      to: null
    })
  })

  it("даёт ссылку «перейти к сущности» только известным типам", () => {
    expect(auditEntityLink("user", "user-42")).toBe("/admin/users/user-42")
    expect(auditEntityLink("planGrant", "grant-1")).toBe("/admin/grants")
    expect(auditEntityLink("unknownThing", "x")).toBeNull()
  })
})
