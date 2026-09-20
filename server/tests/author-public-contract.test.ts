import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import {
  buildASTSchema,
  getNamedType,
  isEnumType,
  isObjectType,
  type GraphQLNamedType,
  type GraphQLSchema
} from "graphql"
import path from "path"
import { describe, expect, it } from "vitest"

/**
 * Контракт публичной страницы автора (`docs/spec/20-public/author.md` §4,
 * `50-access/visibility.md` п. 4, ADR-0018): в ответе нет e-mail, роли, плана, срока плана и
 * сессий. Проверяется вся достижимая часть типа, а не один список полей: поле любой глубины,
 * названное как ПДн или служебное состояние, ломает тест.
 */
const schema: GraphQLSchema = buildASTSchema(
  mergeTypeDefs(loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] }))
)

const FORBIDDEN_FIELDS = [
  "email",
  "role",
  "plantier",
  "planuntil",
  "plan",
  "sessions",
  "archivemode",
  "archivereason",
  "namecheckstatus",
  "avatarcheckstatus"
]

/** Все поля типа и вложенных в него объектных типов; рекурсия по кругу не зацикливается. */
const reachableFields = (type: GraphQLNamedType, seen = new Set<string>()): string[] => {
  if (!isObjectType(type) || seen.has(type.name)) return []
  seen.add(type.name)

  const fields: string[] = []
  for (const field of Object.values(type.getFields())) {
    fields.push(`${type.name}.${field.name}`)
    fields.push(...reachableFields(getNamedType(field.type), seen))
  }
  return fields
}

const forbidden = (typeName: string): string[] =>
  reachableFields(schema.getType(typeName)!).filter((field) =>
    FORBIDDEN_FIELDS.includes(field.split(".")[1]!.toLowerCase())
  )

describe("публичный контракт страницы автора", () => {
  it("объявляет запрос `author(handle)` и ленту `feed(scope: author)`", () => {
    const query = schema.getQueryType()!.getFields()

    expect(query.author).toBeDefined()
    expect(getNamedType(query.author!.type).name).toBe("AuthorProfile")
    expect(query.feed!.args.map((arg) => arg.name)).toContain("handle")

    const scope = schema.getType("FeedScope")
    expect(isEnumType(scope)).toBe(true)
    if (!isEnumType(scope)) return
    expect(scope.getValues().map((value) => value.name)).toContain("author")
  })

  it("не содержит e-mail, роли, плана и сессий ни на одном уровне ответа", () => {
    expect(forbidden("AuthorProfile")).toEqual([])
    expect(forbidden("Feed")).toEqual([])
    expect(forbidden("AuthorCatalog")).toEqual([])
  })

  it("та же проверка находит служебные поля там, где они есть", () => {
    // Контроль самой проверки: в типе кабинета e-mail и роль объявлены законно, и если
    // обход перестанет их видеть, пустой результат для публичных типов ничего не докажет.
    expect(forbidden("AccountUser")).toEqual(
      expect.arrayContaining(["AccountUser.email", "AccountUser.role", "AccountUser.nameCheckStatus"])
    )
  })

  it("уровень автора виден бейджем, а не планом", () => {
    const profile = schema.getType("AuthorProfile")
    expect(isObjectType(profile)).toBe(true)
    if (!isObjectType(profile)) return

    expect(getNamedType(profile.getFields().grade!.type).name).toBe("AuthorGrade")
    expect(Object.keys(profile.getFields()).sort()).toEqual([
      "avatar",
      "bio",
      "firstPublishedAt",
      "grade",
      "handle",
      "id",
      "links",
      "name",
      "publishedCount",
      "redirect"
    ])
  })

  it("черновых запросов страницы автора в схеме не осталось", () => {
    const query = schema.getQueryType()!.getFields()

    expect(query.articlesByAuthor).toBeUndefined()
    expect(query.authorStats).toBeUndefined()
    expect(schema.getType("ArticlesByAuthorResponse")).toBeUndefined()
    expect(schema.getType("AuthorStats")).toBeUndefined()
  })
})
