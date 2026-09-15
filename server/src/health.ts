import type { RequestListener } from "node:http"

interface Health {
  status: "ok" | "unavailable"
  revision: string | null
  checks: { postgres: boolean; redis: boolean }
}

interface Dependencies {
  postgres: () => Promise<unknown>
  redis: () => Promise<boolean>
}

export const createHealthCheck = (dependencies: Dependencies, commit?: string): (() => Promise<Health>) => {
  const revision = commit && /^[0-9a-f]{40}$/.test(commit) ? commit : null
  let cached: Health | undefined
  let expiresAt = 0
  let inFlight: Promise<Health> | undefined

  return () => {
    if (cached && Date.now() < expiresAt) return Promise.resolve(cached)
    if (inFlight) return inFlight

    const checks = { postgres: false, redis: false }
    let timedOut = false
    const result = (): Health => ({
      status: checks.postgres && checks.redis ? "ok" : "unavailable",
      revision,
      checks: { ...checks }
    })
    const postgres = Promise.resolve()
      .then(dependencies.postgres)
      .then((rows) => {
        checks.postgres = Array.isArray(rows) && rows.length === 1 && rows[0]?.ok === 1
      })
      .catch(() => undefined)
    const redis = Promise.resolve()
      .then(dependencies.redis)
      .then((ready) => {
        checks.redis = ready === true
      })
      .catch(() => undefined)

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
      void Promise.all([postgres, redis]).then(() => {
        clearTimeout(timeout)
        if (!timedOut) complete()
        // После HTTP timeout не запускаем новые запросы, пока старые реально не завершились.
        inFlight = undefined
      })
    })
    return inFlight
  }
}

export const withHealth =
  (fallback: RequestListener, check: () => Promise<Health>): RequestListener =>
  (request, response) => {
    if (request.method !== "GET" || request.url?.split("?", 1)[0] !== "/health") {
      fallback(request, response)
      return
    }
    void check().then((health) => {
      if (response.destroyed || response.writableEnded) return
      response.statusCode = health.status === "ok" ? 200 : 503
      response.setHeader("content-type", "application/json; charset=utf-8")
      response.setHeader("cache-control", "no-store")
      response.end(JSON.stringify(health))
    })
  }
