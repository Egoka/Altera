import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import { buildASTSchema, isEnumType } from "graphql"
import path from "path"
import { ArticleStatus } from "../src/generated/prisma"
import { describe, expect, test } from "vitest"

describe("Article status schema contract", () => {
  test("keeps Prisma and GraphQL article statuses aligned with the specification", () => {
    const expectedStatuses = ["draft", "ai_check", "review", "in_review", "rework", "published", "archived"]
    const prismaStatuses = Object.values(ArticleStatus)
    const typeDefs = loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] })
    const schema = buildASTSchema(mergeTypeDefs(typeDefs))
    const articleStatusType = schema.getType("ArticleStatus")

    expect(isEnumType(articleStatusType)).toBe(true)
    if (!isEnumType(articleStatusType)) return

    const graphqlStatuses = articleStatusType.getValues().map(({ name }) => name)

    expect(prismaStatuses).toEqual(expectedStatuses)
    expect(graphqlStatuses).toEqual(expectedStatuses)
    expect(prismaStatuses).toEqual(graphqlStatuses)
  })
})
