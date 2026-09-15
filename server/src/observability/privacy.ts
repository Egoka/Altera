import { createHmac } from "node:crypto"

export interface PiiHasher {
  email(value: string): string
  ip(value: string, day: string): string
}

const redacted = "[REDACTED]"
const blockedKeys = new Set([
  "email",
  "ip",
  "token",
  "authorization",
  "cookie",
  "password",
  "magiclink",
  "body",
  "content",
  "text",
  "name"
])
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const magicLinkPattern = /https?:\/\/[^\s]*(?:\/(?:login|auth|verify)|[?&](?:token|code)=)[^\s]*/gi
const bearerPattern = /Bearer\s+[^\s"']+/gi
const jwtPattern = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g

function sanitizeString(value: string): string {
  return value
    .replace(magicLinkPattern, redacted)
    .replace(bearerPattern, redacted)
    .replace(jwtPattern, redacted)
    .replace(emailPattern, redacted)
}

function sanitize(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return sanitizeString(value)
  if (value === null || typeof value !== "object") return value
  if (seen.has(value)) return redacted
  seen.add(value)

  if (value instanceof Error) {
    return {
      type: sanitizeString(value.name),
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
      cause: value.cause === undefined ? undefined : sanitize(value.cause, seen)
    }
  }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((item) => sanitize(item, seen))

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      blockedKeys.has(key.toLowerCase()) ? redacted : sanitize(nestedValue, seen)
    ])
  )
}

export function sanitizeLogValue(value: unknown): unknown {
  return sanitize(value, new WeakSet())
}

export function createPiiHasher(secret: string | undefined): PiiHasher {
  if (!secret?.trim()) throw new Error("LOG_HASH_SECRET is required")

  const digest = (purpose: string, value: string) =>
    createHmac("sha256", secret).update(`${purpose}:${value}`).digest("hex")

  return {
    email(value) {
      return digest("email", value.trim().toLowerCase())
    },
    ip(value, day) {
      return digest(`ip:${day}`, value)
    }
  }
}
