import crypto from "crypto"

const canonicalize = (value: unknown): string => {
  if (value === undefined) return '["undefined"]'
  if (value === null) return '["null"]'

  if (Array.isArray(value)) {
    return `["array",[${value.map(canonicalize).join(",")}]]`
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `[${JSON.stringify(key)},${canonicalize(item)}]`)
    return `["object",[${entries.join(",")}]]`
  }

  return JSON.stringify([typeof value, value])
}

export const buildCacheKey = (namespace: string, args: Readonly<Record<string, unknown>>): string => {
  const digest = crypto.createHash("sha256").update(canonicalize(args)).digest("hex")
  return `cache:v1:data:${namespace}:${digest}`
}
