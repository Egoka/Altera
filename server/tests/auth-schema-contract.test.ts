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

  it("defines hash-only magic-link storage keyed by address, not by account", () => {
    const magicLink = model("MagicLinkToken")

    expect(magicLink).toMatch(/^\s*tokenHash\s+String\s+@unique\s+@db\.VarChar\(64\)$/m)
    expect(magicLink).not.toMatch(/^\s*token\s+/m)
    expect(magicLink).not.toContain("@@index([tokenHash])")
    // Первый вход создаёт аккаунт при подтверждении ссылки, поэтому запрос по неизвестному
    // адресу не может ссылаться на пользователя (session-lifecycle.md п. 2).
    expect(magicLink).toMatch(/^\s*email\s+String\s+@unique$/m)
    expect(magicLink).not.toMatch(/^\s*userId\s+/m)
    expect(magicLink).not.toContain("references: [id]")
    // Ссылка возвращает пользователя туда, откуда он ушёл, без открытого параметра в письме.
    expect(magicLink).toMatch(/^\s*next\s+String\?$/m)
    expect(magicLink).toMatch(/^\s*termsVersion\s+Int\?$/m)
    expect(magicLink).toMatch(/^\s*privacyVersion\s+Int\?$/m)
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
    // Ограниченная сессия самостоятельно архивированного аккаунта (session-lifecycle.md п. 7).
    expect(session).toContain("limited           Boolean   @default(false)")
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

  it("moves magic links onto the address key in a dedicated migration", () => {
    const migration = readFileSync(
      path.join(prismaDir, "migrations/20260920090000_magic_link_pending_registration/migration.sql"),
      "utf8"
    )

    expect(migration).toContain('DELETE FROM "magic_link_tokens";')
    expect(migration).toContain('DROP CONSTRAINT "magic_link_tokens_userId_fkey"')
    expect(migration).toContain('DROP INDEX "magic_link_tokens_userId_key"')
    expect(migration).toContain('CREATE UNIQUE INDEX "magic_link_tokens_email_key"')
    expect(migration).toContain('ADD COLUMN "limited" BOOLEAN NOT NULL DEFAULT false')
    expect(migration).not.toMatch(/IF (NOT )?EXISTS/)
  })
})

/**
 * Ветка пароля T-115: хэш пароля и отметка подтверждения адреса лежат в самой записи, а
 * одноразовые ссылки подтверждения и сброса — в отдельной таблице по паре «адрес + вид».
 */
describe("password branch persistence schema", () => {
  it("stores only a password hash and the address confirmation mark on the account", () => {
    const user = model("User")

    expect(user).toMatch(/^\s*passwordHash\s+String\?$/m)
    expect(user).toMatch(/^\s*passwordUpdatedAt\s+DateTime\?$/m)
    expect(user).toMatch(/^\s*emailVerifiedAt\s+DateTime\?$/m)
    // Открытого пароля в схеме нет ни под каким именем.
    expect(user).not.toMatch(/^\s*password\s+String/m)
  })

  it("keeps confirmation and reset tokens hash-only, one per address and purpose", () => {
    const token = model("PasswordToken")

    expect(token).toMatch(/^\s*tokenHash\s+String\s+@unique\s+@db\.VarChar\(64\)$/m)
    expect(token).not.toMatch(/^\s*token\s+/m)
    expect(token).toMatch(/^\s*purpose\s+PasswordTokenPurpose$/m)
    expect(token).toMatch(/^\s*usedAt\s+DateTime\?$/m)
    expect(token).toContain("@@unique([email, purpose])")
    expect(schema).toMatch(/enum PasswordTokenPurpose \{\n\s*email_confirm\n\s*password_reset\n\}/)
  })

  it("confirms existing addresses in the password-login migration", () => {
    const migration = readFileSync(
      path.join(prismaDir, "migrations/20260928200000_password_login/migration.sql"),
      "utf8"
    )

    expect(migration).toContain('CREATE TYPE "PasswordTokenPurpose"')
    expect(migration).toContain('ADD COLUMN "passwordHash" TEXT')
    // Записи до ветки пароля заведены подтверждением ссылки: их адрес уже подтверждён.
    expect(migration).toContain('UPDATE "users" SET "emailVerifiedAt" = "createdAt"')
    expect(migration).toContain('CREATE UNIQUE INDEX "password_tokens_email_purpose_key"')
    expect(migration).not.toMatch(/IF (NOT )?EXISTS/)
  })
})
