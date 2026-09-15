import { randomUUID } from "node:crypto"
import { GraphQLError } from "graphql"
import type { AppLogger } from "../observability/logger"
import { ERROR_DEFINITIONS, pickValidExtensions, type ApiErrorFields, type ErrorCode } from "./dictionary"

interface PublicErrorSnapshot {
  message: string
  extensions: Readonly<Record<string, unknown>>
}

const knownErrors = new WeakMap<object, Readonly<PublicErrorSnapshot>>()
const MAX_ERROR_TRAVERSAL_NODES = 64
const requestIdPublicErrorCodes = new Set<ErrorCode>(["INTERNAL_ERROR", "PROVIDER_UNAVAILABLE"])

function freezeExtensionValue(value: unknown): unknown {
  return Array.isArray(value) ? Object.freeze([...value]) : value
}

function createSnapshot(message: string, extensions: Record<string, unknown>): Readonly<PublicErrorSnapshot> {
  const copiedExtensions = Object.fromEntries(
    Object.entries(extensions).map(([key, value]) => [key, freezeExtensionValue(value)])
  )
  return Object.freeze({ message, extensions: Object.freeze(copiedExtensions) })
}

function isWeakKey(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function"
}

function readLink(value: object, key: "originalError" | "cause"): unknown {
  try {
    return Reflect.get(value, key)
  } catch {
    return undefined
  }
}

function findKnownError(error: unknown): Readonly<PublicErrorSnapshot> | null {
  const queue: unknown[] = [error]
  const visited = new WeakSet<object>()
  let visitedCount = 0

  for (let index = 0; index < queue.length && visitedCount < MAX_ERROR_TRAVERSAL_NODES; index += 1) {
    const current = queue[index]
    if (!isWeakKey(current) || visited.has(current)) continue
    visited.add(current)
    visitedCount += 1

    const snapshot = knownErrors.get(current)
    if (snapshot) return snapshot

    queue.push(readLink(current, "originalError"), readLink(current, "cause"))
  }

  return null
}

function createPublicExtensions(extensions: Readonly<Record<string, unknown>>): Record<string, unknown> {
  if (requestIdPublicErrorCodes.has(extensions.code as ErrorCode)) return { ...extensions }

  return Object.fromEntries(Object.entries(extensions).filter(([key]) => key !== "requestId"))
}

export function createApiError<C extends ErrorCode>(
  code: C,
  fields: ApiErrorFields<C> & { requestId: string }
): GraphQLError {
  const error = new GraphQLError(ERROR_DEFINITIONS[code].message, {
    extensions: { code, ...fields }
  })
  const extensions = pickValidExtensions(error)
  if (!extensions) throw new Error(`Invalid fields for API error code ${code}`)

  knownErrors.set(error, createSnapshot(ERROR_DEFINITIONS[code].message, extensions))
  return error
}

export function isApiError(error: unknown): boolean {
  return findKnownError(error) !== null
}

export function createErrorMasker(options: {
  logger: AppLogger
  requestIdFactory?: () => string
}): (error: unknown, message: string, isDev?: boolean) => GraphQLError {
  const requestIdFactory = options.requestIdFactory ?? randomUUID

  return (error) => {
    const snapshot = findKnownError(error)
    if (snapshot) {
      return new GraphQLError(snapshot.message, { extensions: createPublicExtensions(snapshot.extensions) })
    }

    const requestId = requestIdFactory()
    options.logger.log({
      level: "error",
      event: "error.unhandled",
      requestId,
      message: "Unhandled GraphQL error",
      error
    })
    return createApiError("INTERNAL_ERROR", { requestId })
  }
}
