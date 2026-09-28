import type { IncomingMessage, RequestListener } from "node:http"
import { readdir } from "node:fs/promises"
import { resolve } from "node:path"
import type { Cache } from "../cache"
import { BACKUP_KINDS, disabledBackups, type Backups } from "./backups"
import {
  COMPONENT_NAMES,
  PROVIDER_NAMES,
  disabledComponent,
  downComponent,
  type ComponentName,
  type ComponentState,
  type ProviderName,
  type ProviderProbe
} from "./components"

export const checkMigrations = async (
  query: () => Promise<unknown>,
  directory = resolve(__dirname, "../../prisma/migrations")
): Promise<boolean> => {
  try {
    // src/health/ и dist/health/ имеют общего прародителя; cwd процесса на список не влияет.
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

export interface Health {
  status: "ok" | "degraded" | "unavailable"
  revision: string | null
  checkedAt: string
  /**
   * Контракт готовности процесса: на него опираются проба площадки, `scripts/smoke.sh` и джоб
   * `server-smoke` (ADR-0031). "disabled" у Redis — `REDIS_URL` не задан: кеш работает в режиме
   * noop, Redis не проверяется (ADR-0019).
   */
  checks: { postgres: boolean; redis: boolean | "disabled"; migrations: boolean }
  /** Состояние зависимостей для раздела #22 (§29.3, `40-admin/errors-and-health.md` §3). */
  components: Record<ComponentName, ComponentState>
  /** Возраст последней успешной резервной копии базы и медиа (журнал §29.9). */
  backups: Backups
}

interface Dependencies {
  postgres: () => Promise<unknown>
  // Отсутствует, когда Redis не настроен.
  redis?: () => Promise<boolean>
  migrations: () => Promise<boolean>
  /** Провайдеры без проверки считаются неподключёнными: `disabled`, а не деградация. */
  providers?: Partial<Record<ProviderName, ProviderProbe>>
  /** Без монитора копий их состояние — `disabled` (наблюдение не настроено). */
  backups?: () => Promise<Backups>
}

export interface HealthCheckOptions {
  /**
   * Вызывается один раз на каждую настоящую проверку (не на ответ из кеша): здесь живут запись
   * `system.health` и оповещение о деградации.
   */
  onCheck?: (health: Health) => void
}

export const redisReadiness = (cache: Pick<Cache, "mode" | "isReady">): (() => Promise<boolean>) | undefined =>
  cache.mode === "redis" ? () => cache.isReady() : undefined

export const createHealthCheck = (
  dependencies: Dependencies,
  commit?: string,
  options: HealthCheckOptions = {}
): (() => Promise<Health>) => {
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
    // Начальное состояние — недоступно: проверка, не ответившая до HTTP deadline, не выдаётся
    // за исправную зависимость. `disabled` остаётся только там, где проверки нет вовсе.
    const providerInitial = (name: ProviderName): ComponentState =>
      dependencies.providers?.[name] ? downComponent(null) : disabledComponent()
    const components: Record<ComponentName, ComponentState> = {
      db: downComponent("postgres"),
      redis: dependencies.redis ? downComponent("redis") : disabledComponent(),
      psp: providerInitial("psp"),
      ai: providerInitial("ai"),
      mail: providerInitial("mail"),
      storage: providerInitial("storage")
    }
    let backups: Backups = disabledBackups()
    let timedOut = false
    // 503 — только неготовая база или схема; недоступные кеш, провайдер и просроченная копия —
    // деградация без 503 (docs/spec/80-observability/health-and-alerts.md п. 1, 7).
    const result = (): Health => {
      const degraded =
        COMPONENT_NAMES.some((name) => components[name].status === "down") ||
        BACKUP_KINDS.some((kind) => backups[kind].status === "overdue" || backups[kind].status === "unknown")
      return {
        status: !checks.postgres || !checks.migrations ? "unavailable" : degraded ? "degraded" : "ok",
        revision,
        checkedAt: new Date().toISOString(),
        checks: { ...checks },
        components: { ...components },
        backups: { database: { ...backups.database }, media: { ...backups.media } }
      }
    }
    const measured = async <T>(call: () => Promise<T>): Promise<{ value: T; latencyMs: number }> => {
      const startedAt = Date.now()
      const value = await call()
      return { value, latencyMs: Math.max(0, Date.now() - startedAt) }
    }
    const postgres = measured(dependencies.postgres)
      .then(({ value: rows, latencyMs }) => {
        checks.postgres = Array.isArray(rows) && rows.length === 1 && rows[0]?.ok === 1
        components.db = { status: checks.postgres ? "up" : "down", adapter: "postgres", latencyMs }
      })
      .catch(() => undefined)

    const migrations = Promise.resolve()
      .then(dependencies.migrations)
      .then((ready) => {
        checks.migrations = ready === true
      })
      .catch(() => undefined)
    const redisCheck = dependencies.redis
    const redis = redisCheck
      ? measured(redisCheck)
          .then(({ value: ready, latencyMs }) => {
            checks.redis = ready === true
            components.redis = { status: ready === true ? "up" : "down", adapter: "redis", latencyMs }
          })
          .catch(() => undefined)
      : Promise.resolve()
    const providers = PROVIDER_NAMES.map((name) => {
      const probe = dependencies.providers?.[name]
      if (!probe) return Promise.resolve()
      return Promise.resolve()
        .then(probe)
        .then((state) => {
          components[name] = state
        })
        .catch(() => {
          components[name] = downComponent(null)
        })
    })
    const backupsCheck = dependencies.backups
    const backupState = backupsCheck
      ? Promise.resolve()
          .then(backupsCheck)
          .then((state) => {
            backups = state
          })
          .catch(() => undefined)
      : Promise.resolve()

    inFlight = new Promise<Health>((resolve) => {
      const complete = () => {
        cached = result()
        expiresAt = Date.now() + 2000
        options.onCheck?.(cached)
        resolve(cached)
      }
      const timeout = setTimeout(() => {
        timedOut = true
        complete()
      }, 4000)
      void Promise.all([postgres, redis, migrations, backupState, ...providers]).then(() => {
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
