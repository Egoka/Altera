import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import { buildASTSchema, isEnumType, isInputObjectType, isObjectType, validateSchema } from "graphql"
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

  test("exposes Section, optional Format, and Tag without legacy taxonomy names", () => {
    const typeDefs = loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] })
    const schema = buildASTSchema(mergeTypeDefs(typeDefs))
    const article = schema.getType("Article")
    const createArticle = schema.getType("CreateArticleInput")
    const taxonomyStatus = schema.getType("TaxonomyStatus")

    expect(isObjectType(article)).toBe(true)
    expect(isInputObjectType(createArticle)).toBe(true)
    expect(isEnumType(taxonomyStatus)).toBe(true)
    if (!isObjectType(article) || !isInputObjectType(createArticle) || !isEnumType(taxonomyStatus)) return

    expect(article.getFields().section.type.toString()).toBe("Section")
    expect(article.getFields().format.type.toString()).toBe("Format")
    expect(article.getFields().tags.type.toString()).toBe("[Tag!]!")
    expect(createArticle.getFields().sectionId.type.toString()).toBe("ID")
    expect(createArticle.getFields().formatId.type.toString()).toBe("ID")
    expect(schema.getType("ContentType")).toBeUndefined()
    expect(schema.getType("SectionTag")).toBeUndefined()
    expect(taxonomyStatus.getValues().map(({ name }) => name)).toEqual(["active", "archived"])
  })
})
