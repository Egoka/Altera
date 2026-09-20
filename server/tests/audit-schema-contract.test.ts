import path from "node:path"
import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import { buildASTSchema, isObjectType, parse, validate } from "graphql"
import { describe, expect, it } from "vitest"

const schema = buildASTSchema(
  mergeTypeDefs(loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] }))
)

const readOperation = /* GraphQL */ `
  query AuditContract($filters: AuditLogFilters, $id: ID!) {
    auditLog(filters: $filters, limit: 20, cursor: "2026-09-20T10:00:00.000Z|audit-1") {
      entries {
        id
        action
        createdAt
        actor {
          id
          role
          name
          isSystem
        }
        entityType
        entityId
        requestId
        zones
        changedFields
      }
      nextCursor
      zone
      canExport
    }
    auditEntry(id: $id) {
      diff
      subject
      context
      purpose
      requestId
    }
    auditSummary(filters: $filters) {
      total
      byAction {
        key
        count
      }
      byActor {
        key
        label
        count
      }
    }
  }
`

describe("контракт GraphQL аудита", () => {
  it("принимает полную операцию чтения журнала", () => {
    expect(validate(schema, parse(readOperation)).map((error) => error.message)).toEqual([])
  })

  it("не содержит мутаций изменения журнала: только экспорт", () => {
    const mutation = schema.getMutationType()
    const auditMutations = Object.keys(mutation && isObjectType(mutation) ? mutation.getFields() : {}).filter((name) =>
      name.toLowerCase().includes("audit")
    )

    expect(auditMutations).toEqual(["exportAudit"])
  })

  it("в типе выгрузки нет полей с персональными данными", () => {
    const type = schema.getType("AuditExport")
    const fields = Object.keys(type && isObjectType(type) ? type.getFields() : {})

    expect(fields).toEqual(["filename", "contentType", "rows", "csv"])
  })

  it("зоны ограничены тремя темами visibility.md п. 10", () => {
    const zoneValues = schema.getType("AuditZone")
    const names = zoneValues && "getValues" in zoneValues ? zoneValues.getValues().map((value) => value.name) : []

    expect(names).toEqual(["editorial", "moderation", "financeAndPd"])
  })
})
