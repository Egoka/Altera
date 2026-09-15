import type { GraphQLError } from "graphql"

export type ProviderName = "psp" | "ai" | "mail" | "storage"

const definitions = {
  UNAUTHENTICATED: { message: "Authentication required", requiredFields: ["requestId"] },
  FORBIDDEN: { message: "Action forbidden", requiredFields: ["requestId", "action"] },
  NOT_FOUND: { message: "Entity not found", requiredFields: ["requestId", "entity"] },
  VALIDATION_ERROR: {
    message: "Validation failed",
    requiredFields: ["requestId", "field", "rule"]
  },
  CONFLICT: {
    message: "Entity state conflict",
    requiredFields: ["requestId", "entity", "expected", "actual"]
  },
  RATE_LIMITED: { message: "Rate limit exceeded", requiredFields: ["requestId", "retryAfter"] },
  CONTENT_INVALID: {
    message: "Content is invalid",
    requiredFields: ["requestId", "path", "node"]
  },
  DUPLICATE: { message: "Entity already exists", requiredFields: ["requestId", "entity", "field"] },
  INTERNAL_ERROR: { message: "Internal server error", requiredFields: ["requestId"] },
  PLAN_LIMIT: {
    message: "Plan limit exceeded",
    requiredFields: ["requestId", "requiredTier", "limit", "current"]
  },
  PROVIDER_UNAVAILABLE: {
    message: "Provider unavailable",
    requiredFields: ["requestId", "provider"]
  },
  ARCHIVED: { message: "Entity archived", requiredFields: ["requestId", "entity"] }
} as const

export type ErrorCode = keyof typeof definitions

export interface ErrorDefinition {
  message: string
  requiredFields: readonly string[]
}

export const ERROR_DEFINITIONS: Readonly<Record<ErrorCode, ErrorDefinition>> = definitions

interface ApiErrorFieldMap {
  UNAUTHENTICATED: Record<never, never>
  FORBIDDEN: { action: string }
  NOT_FOUND: { entity: string }
  VALIDATION_ERROR: { field: string; rule: string }
  CONFLICT: { entity: string; expected: string | number | boolean; actual: string | number | boolean }
  RATE_LIMITED: { retryAfter: number }
  CONTENT_INVALID: { path: string; node: string }
  DUPLICATE: { entity: string; field: string }
  INTERNAL_ERROR: Record<never, never>
  PLAN_LIMIT: { requiredTier: string; limit: number; current: number }
  PROVIDER_UNAVAILABLE: { provider: ProviderName }
  ARCHIVED: { entity: string }
}

export type ApiErrorFields<C extends ErrorCode> = ApiErrorFieldMap[C]
export type ApiErrorExtensions = { code: ErrorCode; requestId: string } & Record<string, unknown>

const providerNames: readonly ProviderName[] = ["psp", "ai", "mail", "storage"]

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_DEFINITIONS, value)
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && (typeof value !== "string" || value.length > 0)
}

export function pickValidExtensions(error: GraphQLError): ApiErrorExtensions | null {
  const { code } = error.extensions
  if (!isErrorCode(code)) return null

  const definition = ERROR_DEFINITIONS[code]
  if (!definition.requiredFields.every((field) => isPresent(error.extensions[field]))) return null
  if (code === "PROVIDER_UNAVAILABLE" && !providerNames.includes(error.extensions.provider as ProviderName)) {
    return null
  }

  return Object.fromEntries([
    ["code", code],
    ...definition.requiredFields.map((field) => [field, error.extensions[field]])
  ]) as ApiErrorExtensions
}
