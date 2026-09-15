import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import { buildASTSchema, isEnumType } from "graphql"
import path from "path"
import { Role } from "../src/generated/prisma"
import { describe, expect, test } from "vitest"

describe("Role schema contract", () => {
  test("keeps Prisma and GraphQL roles aligned in the canonical order", () => {
    const expectedRoles = ["reader", "author", "editor", "moderator", "analyst", "admin", "owner"]
    const prismaRoles = Object.values(Role)
    const typeDefs = loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] })
    const schema = buildASTSchema(mergeTypeDefs(typeDefs))
    const roleType = schema.getType("Role")

    expect(isEnumType(roleType)).toBe(true)
    if (!isEnumType(roleType)) return

    const graphqlRoles = roleType.getValues().map(({ name }) => name)

    expect(prismaRoles).toEqual(expectedRoles)
    expect(graphqlRoles).toEqual(expectedRoles)
    expect(prismaRoles).toEqual(graphqlRoles)
  })
})
