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

  test("exposes the public handle without account fields or the legacy slug", () => {
    const typeDefs = loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] })
    const schema = buildASTSchema(mergeTypeDefs(typeDefs))
    const userType = schema.getType("User")

    expect(isObjectType(userType)).toBe(true)
    if (!isObjectType(userType)) return

    expect(userType.getFields()).toHaveProperty("handle")

    const forbiddenFields = ["email", "role", "planTier", "sessions", "slug"]
    const exposedFields = forbiddenFields.filter((field) => field in userType.getFields())

    expect(exposedFields).toEqual([])
  })
})
