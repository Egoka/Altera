import type { IncomingMessage, RequestListener } from "node:http"
import { readdir } from "node:fs/promises"
import { resolve } from "node:path"
import type { Cache } from "./cache"

export const checkMigrations = async (
  query: () => Promise<unknown>,
  directory = resolve(__dirname, "../prisma/migrations")
): Promise<boolean> => {
  try {
    // src/ и dist/ имеют общего родителя; cwd процесса не влияет на список миграций.
    const expected = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    if (!expected.length) return false
    const rows = await query()
    if (!Array.isArray(rows)) return false
    const completed = new Set<string>()
    for (const row of rows) {
      if (!row || typeof row.migration_name !== "string") return false
      if (row.rolled_back_at instanceof Date) continue
      if (
        row.rolled_back_at !== null ||
        !(row.finished_at instanceof Date) ||
        !Number.isFinite(row.finished_at.getTime())
      )
        return false
      completed.add(row.migration_name)
    }
    return expected.every((name) => completed.has(name))
  } catch {
    return false
  }
}

interface Health {
  status: "ok" | "degraded" | "unavailable"
  revision: string | null
  // "disabled" — REDIS_URL не задан: кеш работает в режиме noop, Redis не проверяется (ADR-0019).
  checks: { postgres: boolean; redis: boolean | "disabled"; migrations: boolean }
}

interface Dependencies {
  postgres: () => Promise<unknown>
  // Отсутствует, когда Redis не настроен.
  redis?: () => Promise<boolean>
  migrations: () => Promise<boolean>
}

export const redisReadiness = (cache: Pick<Cache, "mode" | "isReady">): (() => Promise<boolean>) | undefined =>
  cache.mode === "redis" ? () => cache.isReady() : undefined

export const createHealthCheck = (dependencies: Dependencies, commit?: string): (() => Promise<Health>) => {
  const revision = commit && /^[0-9a-f]{40}$/.test(commit) ? commit : null
  let cached: Health | undefined
  let expiresAt = 0
  let inFlight: Promise<Health> | undefined

  return () => {
    if (cached && Date.now() < expiresAt) return Promise.resolve(cached)
    if (inFlight) return inFlight

    const checks: Health["checks"] = {
      postgres: false,
      redis: dependencies.redis ? false : "disabled",
      migrations: false
    }
    let timedOut = false
    // 503 — только неготовая база или схема; недоступный Redis — деградация без 503
    // (docs/spec/80-observability/health-and-alerts.md п. 1, 7).
    const result = (): Health => ({
      status: !checks.postgres || !checks.migrations ? "unavailable" : checks.redis === false ? "degraded" : "ok",
      revision,
      checks: { ...checks }
    })
    const postgres = Promise.resolve()
      .then(dependencies.postgres)
      .then((rows) => {
        checks.postgres = Array.isArray(rows) && rows.length === 1 && rows[0]?.ok === 1
      })
      .catch(() => undefined)

    const migrations = Promise.resolve()
      .then(dependencies.migrations)
      .then((ready) => {
        checks.migrations = ready === true
      })
      .catch(() => undefined)
    const redis = dependencies.redis
      ? Promise.resolve()
          .then(dependencies.redis)
          .then((ready) => {
            checks.redis = ready === true
          })
          .catch(() => undefined)
      : Promise.resolve()

    inFlight = new Promise<Health>((resolve) => {
      const complete = () => {
        cached = result()
        expiresAt = Date.now() + 2000
        resolve(cached)
      }
      const timeout = setTimeout(() => {
        timedOut = true
        complete()
      }, 4000)
      void Promise.all([postgres, redis, migrations]).then(() => {
        clearTimeout(timeout)
        if (!timedOut) complete()
        // После HTTP timeout не запускаем новые запросы, пока старые реально не завершились.
        inFlight = undefined
      })
    })
    return inFlight
  }
}

// Проба платформы — `GET` или `HEAD` на `/` без строки запроса и без `Accept: text/html`.
// Для Yoga это запрос без заголовка CSRF: он отвергается, и отказ попадает в журнал
// как `error.unhandled`, хотя сервер исправен. Отвечаем на такую пробу сами; GraphiQL
// (`Accept: text/html`) и запросы GraphQL по адресу `/` по-прежнему уходят в Yoga.
const isPortProbe = (request: IncomingMessage): boolean => {
  if (request.method !== "GET" && request.method !== "HEAD") return false
  const [path, query] = (request.url ?? "").split("?", 2)
  if (path !== "/" || query !== undefined) return false
  return !(request.headers.accept ?? "").toLowerCase().includes("text/html")
}

export const withHealth =
  (fallback: RequestListener, check: () => Promise<Health>): RequestListener =>
  (request, response) => {
    if (isPortProbe(request)) {
      response.statusCode = 200
      response.setHeader("content-type", "text/plain; charset=utf-8")
      response.setHeader("cache-control", "no-store")
      response.end("ok")
      return
    }
    if (request.method !== "GET" || request.url?.split("?", 1)[0] !== "/health") {
      fallback(request, response)
      return
    }
    void check().then((health) => {
      if (response.destroyed || response.writableEnded) return
      response.statusCode = health.status === "unavailable" ? 503 : 200
      response.setHeader("content-type", "application/json; charset=utf-8")
      response.setHeader("cache-control", "no-store")
      response.end(JSON.stringify(health))
    })
  }
