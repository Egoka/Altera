import path from "node:path"
import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import { createSchema, createYoga } from "graphql-yoga"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createErrorMasker } from "../src/errors/graphql-error"
import type { GraphQLContext } from "../src/prisma"
import { SECRET_MASK, SYSTEM_SETTINGS_GROUPS, getSystemSettings, readSystemSettings } from "../src/admin/settings"
import settingsResolver from "../src/graphql/settings/resolver"

type Role = "reader" | "author" | "editor" | "moderator" | "analyst" | "admin" | "owner"

const secrets = {
  SMTP_USER: "t082-smtp-user-value",
  SMTP_PASSWORD: "t082-smtp-password-value",
  JWT_ACCESS_SECRET: "t082-jwt-access-value",
  JWT_REFRESH_SECRET: "t082-jwt-refresh-value",
  LOG_HASH_SECRET: "t082-log-hash-value",
  REQUEST_ID_FORWARD_SECRET: "t082-forward-value",
  DATABASE_URL: "postgresql://t082:t082-db-password@db.example.test/altera",
  DATABASE_URL_UNPOOLED: "postgresql://t082:t082-db-password@db.example.test/altera",
  REDIS_URL: "redis://:t082-redis-password@redis.example.test:6379"
}

const env = {
  ...secrets,
  NODE_ENV: "production",
  MAIL_TRANSPORT: "smtp",
  MAIL_FROM: "Altera <no-reply@altera.example>",
  SMTP_HOST: "smtp.altera.example",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  FRONTEND_URL: "https://altera.example",
  MAGIC_LINK_BASE_URL: "https://altera.example/auth/verify"
}

const query = /* GraphQL */ `
  query SystemSettingsContract($group: SystemSettingsGroup!) {
    systemSettings(group: $group) {
      group
      adapter
      canChange
      settings {
        key
        source
        secret
        configured
        value
        mask
      }
    }
  }
`

function context(role: Role | null): GraphQLContext {
  return {
    currentUser: role ? { id: `${role}-1`, role, archivedAt: null, planTier: "free", planUntil: null } : null,
    requestId: "req-t082",
    logger: { log: vi.fn() }
  } as unknown as GraphQLContext
}

const yoga = createYoga<{ role: Role | null }>({
  schema: createSchema<GraphQLContext>({
    typeDefs: mergeTypeDefs(loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] })),
    resolvers: settingsResolver
  }),
  context: ({ role }) => context(role),
  logging: false,
  // Как в server.ts: известные ошибки словаря проходят к клиенту, остальные маскируются.
  maskedErrors: { isDev: false, maskError: createErrorMasker({ logger: { log: vi.fn() } }) }
})

interface Response {
  data?: { systemSettings: { settings: Array<Record<string, unknown>> } } | null
  errors?: Array<{ extensions?: Record<string, unknown> }>
}

// Ответ читается целиком как тело HTTP, чтобы проверка касалась того, что уходит клиенту.
async function request(group: string, role: Role | null): Promise<{ body: string; json: Response }> {
  const response = await yoga.fetch(
    "http://localhost/graphql",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { group } })
    },
    { role }
  )
  const body = await response.text()
  return { body, json: JSON.parse(body) as Response }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("system settings API contract", () => {
  it.each(SYSTEM_SETTINGS_GROUPS)("never returns secret values in the %s group", async (group) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)

    const { body, json } = await request(group, "owner")

    expect(json.errors).toBeUndefined()
    for (const value of Object.values(secrets)) expect(body).not.toContain(value)
    expect(body).not.toContain("t082-db-password")
    expect(body).not.toContain("t082-redis-password")
  })

  it("reports secret presence only as a mask", async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)

    const { json } = await request("mail", "admin")

    const settings = json.data?.systemSettings.settings ?? []
    expect(settings.filter((setting) => setting.secret)).toEqual([
      { key: "SMTP_USER", source: "ENV", secret: true, configured: true, value: null, mask: SECRET_MASK },
      { key: "SMTP_PASSWORD", source: "ENV", secret: true, configured: true, value: null, mask: SECRET_MASK }
    ])
    expect(settings.find((setting) => setting.key === "SMTP_HOST")).toMatchObject({
      configured: true,
      value: "smtp.altera.example",
      mask: null
    })
  })

  it.each(["reader", "author", "editor", "moderator", "analyst"] as const)("forbids %s", async (role) => {
    const { json } = await request("ai", role)

    expect(json.data).toBeNull()
    expect(json.errors?.[0]?.extensions).toMatchObject({ code: "FORBIDDEN", action: "settings.read" })
  })

  it("requires authentication", async () => {
    const { json } = await request("ai", null)

    expect(json.errors?.[0]?.extensions).toMatchObject({ code: "UNAUTHENTICATED" })
  })
})

describe("system settings read model", () => {
  it("keeps every change unavailable before stage 4, including for owner", () => {
    for (const role of ["admin", "owner"] as const) {
      expect(getSystemSettings(context(role), "mail", env).canChange).toBe(false)
    }
  })

  it("marks missing values as not configured without inventing defaults", () => {
    const mail = readSystemSettings("mail", { NODE_ENV: "development" })

    expect(mail.adapter).toBe("console")
    expect(mail.settings.every((setting) => !setting.configured && setting.value === null)).toBe(true)
    expect(readSystemSettings("mail", { NODE_ENV: "production" }).adapter).toBe("unconfigured")
  })

  it("returns every group, including providers not connected yet", () => {
    for (const group of SYSTEM_SETTINGS_GROUPS) expect(readSystemSettings(group, env).group).toBe(group)
    expect(readSystemSettings("ai", env)).toEqual({ group: "ai", adapter: null, settings: [] })
    expect(readSystemSettings("domains", env).settings.map((setting) => setting.key)).toEqual([
      "FRONTEND_URL",
      "MAGIC_LINK_BASE_URL",
      "MAIL_FROM",
      "LOCALES"
    ])
  })
})
