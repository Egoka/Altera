import path from "node:path"
import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import { buildASTSchema, isObjectType, parse, validate } from "graphql"
import { describe, expect, it } from "vitest"

const schema = buildASTSchema(
  mergeTypeDefs(loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] }))
)

const operation = /* GraphQL */ `
  query AdminErrorsContract($filters: ErrorLogFilters, $id: ID!, $period: ErrorPeriodInput!) {
    errorLog(filters: $filters, pagination: { page: 1, limit: 20 }) {
      items {
        id
        signature
        stream
        service
        code
        route
        requestId
        occurrences
        workStatus
        assignedActorId
        assignedActorRole
        firstSeenAt
        lastSeenAt
        updatedAt
      }
      pagination {
        totalItems
      }
    }
    errorEntry(id: $id) {
      stack
      message
      occurrences {
        requestId
        occurredAt
      }
      statusHistory {
        fromStatus
        toStatus
        changedByActorId
        changedByActorRole
        comment
        createdAt
      }
    }
    errorStats(period: $period) {
      currentTotal
      previousTotal
      timeline {
        bucket
        count
      }
      byService {
        key
        count
      }
    }
    healthHistory(period: $period) {
      status
      checkedAt
      components {
        name
        status
        adapter
        latencyMs
      }
      backups {
        kind
        status
        ageHours
      }
    }
  }

  mutation AdminErrorsActions($id: ID!, $ids: [ID!]!, $expectedUpdatedAt: String!, $filters: ErrorLogFilters) {
    setErrorWorkStatus(id: $id, status: in_progress, expectedUpdatedAt: $expectedUpdatedAt, comment: "Разбираю") {
      id
      workStatus
    }
    resolveErrors(ids: $ids) {
      id
      workStatus
    }
    exportErrors(filters: $filters) {
      filename
      contentType
      rows
      csv
    }
  }
`

describe("контракт GraphQL раздела ошибок и состояния", () => {
  it("принимает чтение, смену статуса, массовое решение и CSV", () => {
    expect(validate(schema, parse(operation)).map((error) => error.message)).toEqual([])
  })

  it("не раскрывает стек в типе CSV", () => {
    const type = schema.getType("ErrorExport")
    const fields = Object.keys(type && isObjectType(type) ? type.getFields() : {})
    expect(fields).toEqual(["filename", "contentType", "rows", "csv"])
  })
})
