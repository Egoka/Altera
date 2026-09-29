import path from "node:path"
import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import { buildASTSchema, parse, validate } from "graphql"
import { describe, expect, it } from "vitest"

const schema = buildASTSchema(
  mergeTypeDefs(loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] }))
)

const operation = /* GraphQL */ `
  query StatisticsContract($range: StatisticsRangeInput!) {
    statisticsGrowth(range: $range) {
      range {
        from
        to
      }
      registrations
      activeAccounts
      enabledAuthors
      authorsWithPublications
      daily {
        date
        registrations
        publications
      }
    }
    statisticsContent(range: $range) {
      publications
      drafts
      queueSize
      oldestQueueAgeHours
      medianDecisionHours
      rejectionRate
      manualOverrideRate
      byLocale {
        key
        count
      }
      bySection {
        key
        label
        count
      }
      topAuthors {
        id
        name
        handle
        publications
        qualifiedReads
        saves
      }
      topArticles {
        id
        slug
        title
        authorId
        authorName
        qualifiedReads
        saves
        totalScore
      }
    }
    statisticsAi(range: $range) {
      total
      failed
      failureRate
      averageDurationMs
      costMinor
      byKind {
        key
        count
      }
      byStatus {
        key
        count
      }
    }
  }
`

const exportOperation = /* GraphQL */ `
  mutation StatisticsExportContract($tab: StatisticsTab!, $range: StatisticsRangeInput!) {
    exportStatistics(tab: $tab, range: $range) {
      filename
      contentType
      rows
      csv
    }
  }
`

describe("контракт GraphQL статистики", () => {
  it("принимает независимые запросы вкладок роста, контента и AI", () => {
    expect(validate(schema, parse(operation)).map((error) => error.message)).toEqual([])
  })

  it("принимает агрегированный экспорт текущей вкладки", () => {
    expect(validate(schema, parse(exportOperation)).map((error) => error.message)).toEqual([])
  })
})
