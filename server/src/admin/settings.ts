import { ensureRole } from "../exceptions/permissions"
import type { GraphQLContext } from "../prisma"

// docs/spec/40-admin/system-settings.md: до этапа 4 (журнал #36) настройки задаются
// переменными окружения и только читаются; секреты не возвращаются никому (§27.6, §28.11).
export const SYSTEM_SETTINGS_GROUPS = ["ai", "payments", "mail", "storage", "domains", "limits"] as const

export type SystemSettingsGroup = (typeof SYSTEM_SETTINGS_GROUPS)[number]
export type SystemSettingSource = "ENV" | "CODE"

type SettingsEnv = Readonly<Record<string, string | undefined>>

interface SettingDefinition {
  key: string
  source: SystemSettingSource
  secret: boolean
  read: (env: SettingsEnv) => string | undefined
}

export interface SystemSetting {
  key: string
  source: SystemSettingSource
  secret: boolean
  configured: boolean
  value: string | null
  mask: string | null
}

export interface SystemSettings {
  group: SystemSettingsGroup
  adapter: string | null
  canChange: boolean
  settings: SystemSetting[]
}

export const SECRET_MASK = "••••••••"

const fromEnv = (key: string, secret = false): SettingDefinition => ({
  key,
  source: "ENV",
  secret,
  read: (env) => env[key]
})

// Состав совпадает с server/env.example (спецификация §12): переход на управление из
// интерфейса на этапе 4 не должен менять набор ключей.
const definitions: Record<SystemSettingsGroup, readonly SettingDefinition[]> = {
  ai: [],
  payments: [],
  mail: [
    fromEnv("MAIL_TRANSPORT"),
    fromEnv("MAIL_FROM"),
    fromEnv("SMTP_HOST"),
    fromEnv("SMTP_PORT"),
    fromEnv("SMTP_SECURE"),
    fromEnv("SMTP_USER", true),
    fromEnv("SMTP_PASSWORD", true)
  ],
  storage: [
    fromEnv("STORAGE_DRIVER"),
    fromEnv("STORAGE_MEDIA_BASE_URL"),
    fromEnv("STORAGE_SIGNING_SECRET", true),
    fromEnv("S3_ENDPOINT"),
    fromEnv("S3_REGION"),
    fromEnv("S3_BUCKET"),
    fromEnv("S3_ACCESS_KEY_ID", true),
    fromEnv("S3_SECRET_ACCESS_KEY", true)
  ],
  domains: [
    fromEnv("FRONTEND_URL"),
    fromEnv("MAGIC_LINK_BASE_URL"),
    fromEnv("MAIL_FROM"),
    { key: "LOCALES", source: "CODE", secret: false, read: () => "ru, en" }
  ],
  limits: []
}

// Активный адаптер провайдера группы; null — провайдер ещё не подключён в коде.
const adapters: Partial<Record<SystemSettingsGroup, (env: SettingsEnv) => string>> = {
  mail: (env) => env.MAIL_TRANSPORT || (env.NODE_ENV === "production" ? "unconfigured" : "console"),
  storage: (env) => env.STORAGE_DRIVER || (env.NODE_ENV === "production" ? "unconfigured" : "local")
}

export const isSystemSettingsGroup = (value: unknown): value is SystemSettingsGroup =>
  typeof value === "string" && (SYSTEM_SETTINGS_GROUPS as readonly string[]).includes(value)

function presentSetting(definition: SettingDefinition, env: SettingsEnv): SystemSetting {
  const raw = definition.read(env)
  const configured = raw !== undefined && raw !== ""
  return {
    key: definition.key,
    source: definition.source,
    secret: definition.secret,
    configured,
    value: definition.secret || !configured ? null : (raw ?? null),
    mask: definition.secret && configured ? SECRET_MASK : null
  }
}

export function readSystemSettings(group: SystemSettingsGroup, env: SettingsEnv): Omit<SystemSettings, "canChange"> {
  return {
    group,
    adapter: adapters[group]?.(env) ?? null,
    settings: definitions[group].map((definition) => presentSetting(definition, env))
  }
}

export function getSystemSettings(
  ctx: GraphQLContext,
  group: SystemSettingsGroup,
  env: SettingsEnv = process.env
): SystemSettings {
  // `admin` читает без секретов (§28.11), `owner` — тоже; остальные роли — FORBIDDEN.
  ensureRole(ctx.currentUser, "admin", "settings.read", ctx.requestId)
  // До этапа 4 изменений нет ни у кого: `settings.change` появится вместе с хранением настроек.
  return { ...readSystemSettings(group, env), canChange: false }
}
