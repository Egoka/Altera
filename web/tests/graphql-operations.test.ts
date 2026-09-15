import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { buildSchema, Kind, parse, validate, type DocumentNode, type GraphQLError } from "graphql"
import { describe, expect, it } from "vitest"

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url))
const generatedSchemaPath = join(repositoryRoot, "web/app/graphql/generated/schema.graphql")

const graphqlFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return graphqlFiles(path)
      return entry.isFile() && entry.name.endsWith(".graphql") ? [path] : []
    })
    .sort()

const schema = buildSchema(
  graphqlFiles(join(repositoryRoot, "server/src/graphql"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n")
)

const operationPaths = graphqlFiles(join(repositoryRoot, "web")).filter((path) => path !== generatedSchemaPath)
const operationDocuments = operationPaths.map((path) => ({ path, document: parse(readFileSync(path, "utf8")) }))
const validationErrors = (documents: DocumentNode[]): GraphQLError[] =>
  validate(schema, {
    kind: Kind.DOCUMENT,
    definitions: documents.flatMap((document) => document.definitions)
  })

describe("GraphQL operations", () => {
  it("keeps every web operation valid against the server schema", () => {
    const operations = operationDocuments.flatMap(({ document }) =>
      document.definitions.filter((definition) => definition.kind === Kind.OPERATION_DEFINITION)
    )
    const errors = validationErrors(operationDocuments.map(({ document }) => document))
    const formattedErrors = errors.map((error) => error.message)

    expect(operations.length, "no GraphQL operations found under web/**/*.graphql").toBeGreaterThan(0)
    expect(formattedErrors, operationPaths.map((path) => relative(repositoryRoot, path)).join("\n")).toEqual([])
  })

  it("rejects an operation that selects a field absent from the server schema", () => {
    const errors = validationErrors([parse("query InvalidOperation { fieldThatDoesNotExist }")])

    expect(errors.map((error) => error.message)).toContain(
      'Cannot query field "fieldThatDoesNotExist" on type "Query".'
    )
  })
})
