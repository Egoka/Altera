import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const prismaDir = path.resolve(__dirname, "../prisma")
const schema = readFileSync(path.join(prismaDir, "schema.prisma"), "utf8")

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))
  expect(match, `Prisma model ${name} must exist`).not.toBeNull()
  return match?.[1] ?? ""
}

describe("auth persistence schema", () => {
  it("models the current profile handle and append-only handle registry", () => {
    const user = model("User")
    const history = model("HandleHistory")

    expect(user).toMatch(/^\s*handle\s+String\s+@unique$/m)
    expect(user).toMatch(/^\s*locale\s+Locale\s+@default\(ru\)$/m)
    expect(user).toMatch(/^\s*avatarAssetId\s+String\?$/m)
    expect(user).toMatch(/^\s*prevAvatarId\s+String\?$/m)
    expect(user).toMatch(/^\s*nameCheckStatus\s+ProfileCheckStatus\s+@default\(ok\)$/m)
    expect(user).toMatch(/^\s*avatarCheckStatus\s+ProfileCheckStatus\s+@default\(ok\)$/m)
    expect(user).not.toMatch(/^\s*slug\s+/m)
    expect(history).toMatch(/^\s*handle\s+String\s+@id$/m)
    expect(history).toMatch(/^\s*userId\s+String\?$/m)
    expect(history).toContain("onDelete: SetNull")
    expect(history).toContain("@@index([userId])")
  })

  it("defines hash-only magic-link storage without a duplicate index", () => {
    const magicLink = model("MagicLinkToken")

    expect(magicLink).toMatch(/^\s*tokenHash\s+String\s+@unique\s+@db\.VarChar\(64\)$/m)
    expect(magicLink).not.toMatch(/^\s*token\s+/m)
    expect(magicLink).not.toContain("@@index([tokenHash])")
    expect(magicLink).toContain("onDelete: Cascade")
  })

  it("defines sessions with raw IP and no derived GeoIP fields", () => {
    const session = model("Session")

    expect(session).toMatch(/^\s*tokenHash\s+String\s+@unique\s+@db\.VarChar\(64\)$/m)
    expect(session).toMatch(/^\s*previousTokenHash\s+String\?\s+@db\.VarChar\(64\)$/m)
    expect(session).toContain("expiresAt         DateTime")
    expect(session).toContain("revokedAt         DateTime?")
    expect(session).toContain("userAgent         String?")
    expect(session).toContain("ip                String?")
    expect(session).toContain("lastUsedAt        DateTime  @default(now())")
    expect(session).toContain("@@index([userId])")
    expect(session).toContain("@@index([previousTokenHash])")
    expect(session).toContain("onDelete: Cascade")
    expect(session).not.toMatch(/\b(location|country|region|city|coordinates|latitude|longitude|asn)\b/i)
  })

  it("allows one open email-change request per user without reserving the new email", () => {
    const request = model("EmailChangeRequest")

    expect(request).toContain("userId    String   @unique")
    expect(request).toContain("newEmail  String")
    expect(request).not.toMatch(/^\s*newEmail\s+String\s+@unique/m)
    expect(request).toContain("codeHash  String   @db.VarChar(64)")
    expect(request).toContain("expiresAt DateTime")
    expect(request).toContain("onDelete: Cascade")
  })

  it("keeps named lowercase-hex checks in the migration SQL", () => {
    const migration = readFileSync(
      path.join(prismaDir, "migrations/20260915090200_sessions_hashed_auth_tokens/migration.sql"),
      "utf8"
    )

    expect(migration).toContain('DELETE FROM "magic_link_tokens";')
    expect(migration).toContain('DROP INDEX "magic_link_tokens_token_idx";')
    expect(migration).toContain('CONSTRAINT "magic_link_tokens_tokenHash_check"')
    expect(migration).toContain('CONSTRAINT "sessions_tokenHash_check"')
    expect(migration).toContain('CONSTRAINT "sessions_previousTokenHash_check"')
    expect(migration).toContain('CONSTRAINT "email_change_requests_codeHash_check"')
    expect(migration).not.toMatch(/IF (NOT )?EXISTS/)
  })
})
