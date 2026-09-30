import path from "node:path"
import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import { buildASTSchema, parse, validate } from "graphql"
import { describe, expect, it } from "vitest"

const schema = buildASTSchema(
  mergeTypeDefs(loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] }))
)

const errorsOf = (document: string) => validate(schema, parse(document)).map((error) => error.message)

describe("T-061 account appeal GraphQL contract", () => {
  it("reads the public state and submits once using only the login-link token", () => {
    expect(
      errorsOf(/* GraphQL */ `
        query Appeal($token: String!) {
          accountAppeal(token: $token) {
            locale
            archivedAt
            reasonCategory
            explanation
            staffMessage
            canSubmit
            plan {
              tier
              until
            }
            appeal {
              id
              status
              submittedAt
              decidedAt
            }
          }
        }
      `)
    ).toEqual([])

    expect(
      errorsOf(/* GraphQL */ `
        mutation SubmitAppeal($token: String!, $message: String!) {
          submitAccountAppeal(token: $token, message: $message) {
            id
            status
            submittedAt
          }
        }
      `)
    ).toEqual([])
  })

  it("lets staff decide an open appeal through an explicit decision enum", () => {
    expect(
      errorsOf(/* GraphQL */ `
        mutation DecideAppeal($id: ID!, $decision: AccountAppealDecision!, $reason: String!) {
          decideAppeal(id: $id, decision: $decision, reason: $reason) {
            id
            status
            decidedAt
          }
        }
      `)
    ).toEqual([])
  })
})
