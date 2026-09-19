import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { baselineMigrationScript, migrationsBefore } from "./helpers/migration-database"

const migrationsRoot = path.resolve(__dirname, "../prisma/migrations")
const target = "20260916170000_media_assets"

// История до T-016 уже не меняется: новые миграции получают более поздние имена.
const migrationsBeforeMediaAssets = [
  "20250720172223_db",
  "20250726211815_update_roles",
  "20250726221831_add_magic_link_token",
  "20250727001916_one_to_one_magic_link",
  "20260915090000_role_add_moderator_analyst_owner",
  "20260915090100_user_account_archive_state",
  "20260915090200_sessions_hashed_auth_tokens",
  "20260915170000_user_profile_handle_locale",
  "20260915180000_taxonomy_section_format_tag",
  "20260916120000_admin_operational_records",
  "20260916120000_article_translations_revisions"
]

describe("migration database helper", () => {
  it("lists only migrations older than the target, in migration name order", () => {
    expect(migrationsBefore(target)).toEqual(migrationsBeforeMediaAssets)
  })

  it("builds one baseline script that commits every migration separately and in order", () => {
    const script = baselineMigrationScript(target)
    const segments = script.split(/^-- migration: /m).slice(1)

    expect(segments.map((segment) => segment.slice(0, segment.indexOf("\n")))).toEqual(migrationsBeforeMediaAssets)
    segments.forEach((segment, index) => {
      const sql = readFileSync(path.join(migrationsRoot, migrationsBeforeMediaAssets[index], "migration.sql"), "utf8")
      expect(segment).toContain(sql)
      expect(segment.trimEnd().endsWith(`${sql}\n;\nCOMMIT;`)).toBe(true)
    })
    expect(script).not.toContain(readFileSync(path.join(migrationsRoot, target, "migration.sql"), "utf8"))
  })
})
