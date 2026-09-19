import path from "node:path"
import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import { buildASTSchema, isInputObjectType, parse, validate } from "graphql"
import { describe, expect, it } from "vitest"

const schema = buildASTSchema(
  mergeTypeDefs(loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] }))
)

const query = /* GraphQL */ `
  query AdminGrantsContract {
    adminGrants {
      id
      userId
      userName
      userHandle
      tier
      startsAt
      endsAt
      grantedByName
      reason
      status
      revokedAt
      createdAt
    }
  }
`

describe("admin grants GraphQL contract", () => {
  it("accepts the complete admin grant read operation", () => {
    expect(validate(schema, parse(query)).map((error) => error.message)).toEqual([])
  })

  it("requires endsAt in the manual grant mutation contract", () => {
    const input = schema.getType("GrantPlanInput")

    expect(input?.toString()).toBe("GrantPlanInput")
    expect(input && isInputObjectType(input) ? input.getFields().endsAt?.type.toString() : null).toBe("String!")
  })
})
