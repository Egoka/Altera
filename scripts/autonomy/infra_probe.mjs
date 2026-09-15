import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"

// Только временные сервисы этого CI job; URL с параметрами может переназначить host.
export function validateEnvironment(env) {
  if (env.GITHUB_ACTIONS !== "true" || env.CI !== "true" || env.NODE_ENV !== "test" || env.ALTERA_ISOLATED_CI !== "1") {
    throw new Error("isolated_github_ci_required")
  }
  for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "REDIS_URL"]) {
    let url
    try {
      url = new URL(env[name])
    } catch {
      throw new Error("invalid_dependency_target")
    }
    const database = name !== "REDIS_URL"
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.search ||
      url.hash ||
      !(database ? ["postgres:", "postgresql:"] : ["redis:"]).includes(url.protocol) ||
      url.pathname !== (database ? "/altera_ci" : "/0") ||
      url.port !== (database ? "5432" : "6379")
    ) {
      throw new Error("unsafe_dependency_target")
    }
  }
  if (env.DATABASE_URL !== env.DATABASE_URL_UNPOOLED) throw new Error("database_target_mismatch")
}

export async function probeDependencies(query, ping) {
  const rows = await query("SELECT 1 AS ok, current_setting('server_version_num') AS version")
  if (rows.length !== 1 || rows[0].ok !== 1 || Math.floor(Number(rows[0].version) / 10000) !== 17) {
    throw new Error("postgresql_17_query_failed")
  }
  if ((await ping()) !== "PONG") throw new Error("redis_ping_failed")
  return { database: "passed", redis: "passed" }
}

async function main() {
  const mode = process.argv[2]
  if (mode && mode !== "--migrate") throw new Error("unsupported_mode")
  validateEnvironment(process.env)
  const root = fileURLToPath(new URL("../../", import.meta.url))
  if (mode === "--migrate") {
    const result = spawnSync("pnpm", ["--filter", "server", "exec", "prisma", "migrate", "deploy"], {
      cwd: root,
      env: process.env,
      timeout: 90000,
      stdio: "pipe"
    })
    if (result.error || result.status !== 0) throw new Error("isolated_migrations_failed")
    console.log(JSON.stringify({ schema_version: 1, ok: true, migrations: "passed" }))
    return
  }
  const require = createRequire(new URL("../../server/package.json", import.meta.url))
  const { PrismaClient } = require("./src/generated/prisma")
  const Redis = require("ioredis")
  const prisma = new PrismaClient({ log: [] })
  const redis = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 3000,
    commandTimeout: 3000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    enableOfflineQueue: false
  })
  redis.on("error", () => {})
  const deadline = setTimeout(() => {
    console.log(JSON.stringify({ schema_version: 1, ok: false, reason: "dependency_probe_timeout" }))
    process.exit(1)
  }, 10000)
  try {
    await redis.connect()
    const evidence = await probeDependencies(
      (sql) => prisma.$queryRawUnsafe(sql),
      () => redis.ping()
    )
    console.log(JSON.stringify({ schema_version: 1, ok: true, ...evidence }))
  } finally {
    redis.disconnect()
    await prisma.$disconnect()
    clearTimeout(deadline)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Сообщения драйвера могут включать credentials; наружу выходит только код.
    const safeReasons = new Set([
      "isolated_github_ci_required",
      "invalid_dependency_target",
      "unsafe_dependency_target",
      "database_target_mismatch",
      "unsupported_mode",
      "isolated_migrations_failed",
      "postgresql_17_query_failed",
      "redis_ping_failed"
    ])
    const reason = safeReasons.has(error.message) ? error.message : "dependency_check_failed"
    console.log(JSON.stringify({ schema_version: 1, ok: false, reason }))
    process.exitCode = 1
  })
}
