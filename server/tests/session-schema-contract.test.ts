import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import { buildASTSchema, isEnumType, isObjectType, type GraphQLSchema } from "graphql"
import path from "path"
import { describe, expect, test } from "vitest"
import { SESSION_BROWSER_CLASSES, SESSION_DEVICE_CLASSES } from "../src/auth/account-sessions"

/**
 * Критерий AC-2 задачи T-025: в ответе API нет поля геолокации. Проверяется по собранной SDL,
 * а не по одному резолверу: поле, добавленное любым модулем, попало бы в тот же контракт.
 * Источник запрета — журнал §25.9 и `docs/spec/30-account/reader/sessions.md` §2.
 */

const GEO_FIELD =
  /^(ip|ipaddress|location|geo|geoip|country|countrycode|region|city|timezone|coordinates|latitude|longitude|asn|isp)$/

const buildSchema = (): GraphQLSchema =>
  buildASTSchema(mergeTypeDefs(loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] })))

describe("account session GraphQL contract", () => {
  test("returns only the fields the page shows", () => {
    const session = buildSchema().getType("AccountSession")

    expect(isObjectType(session)).toBe(true)
    if (!isObjectType(session)) return

    expect(Object.keys(session.getFields()).sort()).toEqual(
      ["browserClass", "createdAt", "deviceClass", "id", "isCurrent", "lastActiveAt"].sort()
    )
  })

  test("carries no geolocation and no raw user-agent anywhere in the session contract", () => {
    const schema = buildSchema()
    const types = ["AccountSession", "SessionRevokeResult", "SessionRevokeAllResult"]

    for (const name of types) {
      const type = schema.getType(name)
      expect(isObjectType(type), `${name} must exist`).toBe(true)
      if (!isObjectType(type)) continue

      for (const field of Object.keys(type.getFields())) {
        expect(GEO_FIELD.test(field.toLowerCase()), `${name}.${field} must not expose location data`).toBe(false)
        expect(field.toLowerCase()).not.toContain("useragent")
      }
    }
  })

  test("keeps device and browser classes in step with the classifier", () => {
    const schema = buildSchema()
    const device = schema.getType("SessionDeviceClass")
    const browser = schema.getType("SessionBrowserClass")

    expect(isEnumType(device)).toBe(true)
    expect(isEnumType(browser)).toBe(true)
    if (!isEnumType(device) || !isEnumType(browser)) return

    expect(
      device
        .getValues()
        .map((value) => value.name)
        .sort()
    ).toEqual([...SESSION_DEVICE_CLASSES].sort())
    expect(
      browser
        .getValues()
        .map((value) => value.name)
        .sort()
    ).toEqual([...SESSION_BROWSER_CLASSES].sort())
  })

  test("hangs the list on the account record only, so no role can read another account", () => {
    const schema = buildSchema()
    const account = schema.getType("AccountUser")
    const query = schema.getQueryType()
    const mutation = schema.getMutationType()

    expect(isObjectType(account)).toBe(true)
    if (!isObjectType(account) || !query || !mutation) return

    expect(account.getFields().sessions.type.toString()).toBe("[AccountSession!]!")
    // Чужие сессии не отдаёт ни один корневой запрос: журнал §26.6 закрывает их аналитику,
    // а карточка пользователя в админке в T-025 не входит.
    for (const field of Object.values(query.getFields())) {
      expect(field.type.toString()).not.toContain("AccountSession")
    }
    for (const field of Object.values(mutation.getFields())) {
      const args = field.args.map((arg) => arg.name)
      if (!field.type.toString().includes("Session")) continue
      expect(args.every((arg) => arg !== "userId")).toBe(true)
    }
  })
})
