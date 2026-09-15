import { createHash, createHmac, timingSafeEqual } from "node:crypto"

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

export function hashEmailChangeCode(code: string, secret: string): string {
  return createHmac("sha256", secret).update(`email-change:${code}`, "utf8").digest("hex")
}

export function equalHexHashes(left: string, right: string): boolean {
  if (!SHA256_HEX_PATTERN.test(left) || !SHA256_HEX_PATTERN.test(right)) return false

  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"))
}
