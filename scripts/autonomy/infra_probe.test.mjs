import assert from "node:assert/strict"
import test from "node:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { validateEnvironment, probeDependencies } from "./infra_probe.mjs"

const environment = {
  GITHUB_ACTIONS: "true",
  CI: "true",
  NODE_ENV: "test",
  ALTERA_ISOLATED_CI: "1",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/altera_ci",
  DATABASE_URL_UNPOOLED: "postgresql://test:test@127.0.0.1:5432/altera_ci",
  REDIS_URL: "redis://127.0.0.1:6379/0"
}

test("rejects migrations outside explicitly isolated GitHub CI", () => {
  assert.doesNotThrow(() => validateEnvironment(environment))
  for (const [name, value] of [
    ["GITHUB_ACTIONS", "false"],
    ["ALTERA_ISOLATED_CI", ""],
    ["NODE_ENV", "production"],
    ["DATABASE_URL", "postgresql://u:secret@production.example.com/altera_ci"],
    ["DATABASE_URL_UNPOOLED", "postgresql://test:test@127.0.0.1:5432/production"],
    ["DATABASE_URL", "postgresql://test:test@127.0.0.1:5432/altera_ci?host=production.example.com"],
    ["REDIS_URL", "redis://production.example.com:6379/0"]
  ]) {
    assert.throws(
      () => validateEnvironment({ ...environment, [name]: value }),
      (error) => {
        assert.ok(!error.message.includes("secret"))
        return true
      }
    )
  }
})

test("readiness requires PostgreSQL 17, SELECT 1 and PONG", async () => {
  const sql = async (query) => {
    assert.match(query, /^SELECT 1 AS ok, current_setting\('server_version_num'\)/)
    return [{ ok: 1, version: "170006" }]
  }
  assert.deepEqual(await probeDependencies(sql, async () => "PONG"), { database: "passed", redis: "passed" })
  await assert.rejects(probeDependencies(sql, async () => "LOADING"))
  await assert.rejects(
    probeDependencies(
      async () => [{ ok: 1, version: "160009" }],
      async () => "PONG"
    )
  )
  await assert.rejects(
    probeDependencies(
      async () => {
        throw new Error("unavailable")
      },
      async () => "PONG"
    )
  )
})

test("migration CLI blocks unsafe target before executing pnpm and emits safe reason", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./infra_probe.mjs", import.meta.url)), "--migrate"],
    {
      env: {
        ...environment,
        PATH: "/nonexistent",
        DATABASE_URL: "postgresql://u:secret@production.example.com/altera_ci"
      },
      encoding: "utf8"
    }
  )
  assert.equal(result.status, 1)
  assert.deepEqual(JSON.parse(result.stdout), { schema_version: 1, ok: false, reason: "unsafe_dependency_target" })
  assert.ok(!result.stdout.includes("secret"))
  assert.equal(result.stderr, "")
})
