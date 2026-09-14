import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import { buildASTSchema, isObjectType, validateSchema } from "graphql"
import path from "path"
import { describe, expect, test } from "vitest"

describe("public GraphQL schema", () => {
  test("assembles every SDL file into a valid schema", () => {
    const typeDefs = loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] })
    const schema = buildASTSchema(mergeTypeDefs(typeDefs))

    expect(validateSchema(schema)).toEqual([])
  })

  test.todo("T-027: public User type does not expose account fields", () => {
    const typeDefs = loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] })
    const schema = buildASTSchema(mergeTypeDefs(typeDefs))
    const userType = schema.getType("User")

    expect(isObjectType(userType)).toBe(true)
    if (!isObjectType(userType)) return

    const forbiddenFields = ["email", "role", "planTier", "sessions"]
    const exposedFields = forbiddenFields.filter((field) => field in userType.getFields())

    expect(exposedFields).toEqual([])
  })
})
