import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import { checkMigrations, createHealthCheck, redisReadiness, withHealth } from "../src/health"
import { createCache } from "../src/cache"
import { NoopCache } from "../src/cache/noop"
import { RedisCache, type CacheRedisClient } from "../src/cache/redis"

const revision = "a".repeat(40)
const servers: Server[] = []

interface Checks {
  postgres: boolean
  redis: boolean | "disabled"
  migrations: boolean
}

/** Проверка ответила: задержка измерена. */
const measured = (status: "up" | "down", adapter: string) => ({ status, adapter, latencyMs: expect.any(Number) })
/** Проверка не ответила до общего предела: состояние недоступно, задержки нет. */
const unmeasured = (adapter: string) => ({ status: "down", adapter, latencyMs: null })
const disabled = { status: "disabled", adapter: null, latencyMs: null }
/** Провайдеры без проверки — неподключённые: это не деградация. */
const providersOff = { psp: disabled, ai: disabled, mail: disabled, storage: disabled }
/** Без монитора копий наблюдение за ними не настроено; пороги — из `health/backups.ts`. */
const backupsOff = {
  database: { status: "disabled", lastSuccessAt: null, ageSeconds: null, maxAgeSeconds: 86_400 },
  media: { status: "disabled", lastSuccessAt: null, ageSeconds: null, maxAgeSeconds: 604_800 }
}

/** Полный контракт ответа: лишних полей в нём быть не должно, иначе наружу поедет неизвестное. */
const body = (
  status: string,
  revisionValue: string | null,
  checks: Checks,
  components: { db: unknown; redis: unknown }
) => ({
  status,
  revision: revisionValue,
  checkedAt: expect.any(String),
  checks,
  components: { ...components, ...providersOff },
  backups: backupsOff
})

function redisClient(ping: CacheRedisClient["ping"]): CacheRedisClient {
  const client: CacheRedisClient = {
    on: () => client,
    ping,
    get: async () => null,
    multi: () => {
      throw new Error("not used")
    },
    eval: async () => undefined,
    quit: async () => undefined
  }
  return client
}

async function serve(check: ReturnType<typeof createHealthCheck>) {
  const server = createServer(
    withHealth((_request, response) => {
      response.statusCode = 418
      response.end("graphql fallback")
    }, check)
  )
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        })
    )
  )
})

describe("HTTP readiness", () => {
  it("requires a real Redis PONG and rejects noop or failed cache connections", async () => {
    const client = redisClient(vi.fn(async () => "PONG"))
    const cache = new RedisCache(client, 60)
    expect(await cache.isReady()).toBe(true)
    vi.mocked(client.ping).mockResolvedValue("LOADING")
    expect(await cache.isReady()).toBe(false)
    vi.mocked(client.ping).mockRejectedValue(new Error("private connection detail"))
    expect(await cache.isReady()).toBe(false)
    expect(await new NoopCache().isReady()).toBe(false)
  })
  it("serves actual dependency results and exact revision without changing GraphQL routing", async () => {
    const check = createHealthCheck(
      { postgres: async () => [{ ok: 1 }], migrations: async () => true, redis: async () => true },
      revision
    )
    const url = await serve(check)
    const response = await fetch(`${url}/health?probe=1`)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual(
      body(
        "ok",
        revision,
        { postgres: true, redis: true, migrations: true },
        {
          db: measured("up", "postgres"),
          redis: measured("up", "redis")
        }
      )
    )
    expect((await fetch(`${url}/`, { headers: { accept: "text/html" } })).status).toBe(418)
    expect((await fetch(`${url}/health`, { method: "POST" })).status).toBe(418)
  })

  it("answers the platform port probe on / without handing it to GraphQL", async () => {
    const check = createHealthCheck({
      postgres: async () => [{ ok: 1 }],
      migrations: async () => true,
      redis: async () => true
    })
    const url = await serve(check)
    const probe = await fetch(url)
    expect(probe.status).toBe(200)
    expect(await probe.text()).toBe("ok")
    expect(probe.headers.get("cache-control")).toBe("no-store")
    const headProbe = await fetch(url, { method: "HEAD" })
    expect(headProbe.status).toBe(200)
    expect(await headProbe.text()).toBe("")
    expect((await fetch(url, { headers: { accept: "text/html" } })).status).toBe(418)
    expect((await fetch(`${url}/?query=%7B__typename%7D`)).status).toBe(418)
    expect((await fetch(url, { method: "POST" })).status).toBe(418)
  })

  it("returns 503 and no driver errors or invalid revision", async () => {
    const check = createHealthCheck(
      {
        postgres: async () => {
          throw new Error("postgresql://user:private-value@host/db")
        },
        migrations: async () => false,
        redis: async () => false
      },
      "private-invalid-revision"
    )
    const url = await serve(check)
    const response = await fetch(`${url}/health`)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual(
      body(
        "unavailable",
        null,
        { postgres: false, redis: false, migrations: false },
        {
          db: unmeasured("postgres"),
          redis: measured("down", "redis")
        }
      )
    )
  })

  it("requires SELECT 1 result instead of accepting arbitrary successful query output", async () => {
    const check = createHealthCheck({
      postgres: async () => [{ ok: 0 }],
      migrations: async () => true,
      redis: async () => true
    })
    expect(await check()).toEqual(
      body(
        "unavailable",
        null,
        { postgres: false, redis: true, migrations: true },
        {
          db: measured("down", "postgres"),
          redis: measured("up", "redis")
        }
      )
    )
  })

  it("shares concurrent probes and caches completed results for two seconds", async () => {
    vi.useFakeTimers()
    const postgres = vi.fn(async () => [{ ok: 1 }])
    const redis = vi.fn(async () => true)
    const check = createHealthCheck({ postgres, redis, migrations: async () => true }, revision)
    const results = await Promise.all(Array.from({ length: 20 }, () => check()))
    expect(results.every((result) => result.status === "ok")).toBe(true)
    expect(postgres).toHaveBeenCalledTimes(1)
    expect(redis).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1999)
    await check()
    expect(postgres).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2)
    await check()
    expect(postgres).toHaveBeenCalledTimes(2)
  })

  it("answers within four seconds without piling up hung probes or unhandled rejection", async () => {
    vi.useFakeTimers()
    let rejectPostgres!: (error: Error) => void
    const postgres = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectPostgres = reject
        })
    )
    const redis = vi.fn(async () => true)
    const check = createHealthCheck({ postgres, redis, migrations: async () => true })
    const pending = check()
    await vi.advanceTimersByTimeAsync(4000)
    expect(await pending).toEqual(
      body(
        "unavailable",
        null,
        { postgres: false, redis: true, migrations: true },
        {
          db: unmeasured("postgres"),
          redis: measured("up", "redis")
        }
      )
    )
    await vi.advanceTimersByTimeAsync(10000)
    expect((await check()).status).toBe("unavailable")
    expect(postgres).toHaveBeenCalledTimes(1)
    rejectPostgres(new Error("late private error"))
    await vi.advanceTimersByTimeAsync(0)
    postgres.mockImplementation(async () => [{ ok: 1 }])
    expect((await check()).status).toBe("ok")
    expect(postgres).toHaveBeenCalledTimes(2)
  })
})

describe("optional Redis (ADR-0019)", () => {
  const ready = { postgres: async () => [{ ok: 1 }], migrations: async () => true }

  it.each([undefined, "", "  "])(
    "returns 200 and reports Redis as disabled without REDIS_URL (%j)",
    async (redisUrl) => {
      const url = await serve(
        createHealthCheck({ ...ready, redis: redisReadiness(createCache({ redisUrl })) }, revision)
      )
      const response = await fetch(`${url}/health`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(
        body(
          "ok",
          revision,
          { postgres: true, redis: "disabled", migrations: true },
          {
            db: measured("up", "postgres"),
            redis: disabled
          }
        )
      )
    }
  )

  it("returns 503 without driver details when Postgres is down and Redis is disabled", async () => {
    const url = await serve(
      createHealthCheck({
        postgres: async () => {
          throw new Error("postgresql://user:private-value@host/db")
        },
        migrations: async () => true,
        redis: redisReadiness(createCache({}))
      })
    )
    const response = await fetch(`${url}/health`)
    expect(response.status).toBe(503)
    const payload = await response.text()
    expect(payload).not.toContain("private-value")
    expect(JSON.parse(payload)).toEqual(
      body(
        "unavailable",
        null,
        { postgres: false, redis: "disabled", migrations: true },
        {
          db: unmeasured("postgres"),
          redis: disabled
        }
      )
    )
  })

  it("degrades without 503 when configured Redis is unreachable", async () => {
    const cache = new RedisCache(
      redisClient(async () => {
        throw new Error("redis://default:private-password@cache:6379")
      }),
      60
    )
    const url = await serve(createHealthCheck({ ...ready, redis: redisReadiness(cache) }, revision))
    const response = await fetch(`${url}/health`)
    expect(response.status).toBe(200)
    const payload = await response.text()
    expect(payload).not.toContain("private-password")
    expect(JSON.parse(payload)).toEqual(
      body(
        "degraded",
        revision,
        { postgres: true, redis: false, migrations: true },
        {
          db: measured("up", "postgres"),
          redis: measured("down", "redis")
        }
      )
    )
  })

  it("probes configured Redis through the cache client", async () => {
    const ping = vi.fn(async () => "PONG")
    const check = createHealthCheck({ ...ready, redis: redisReadiness(new RedisCache(redisClient(ping), 60)) })
    expect(await check()).toEqual(
      body(
        "ok",
        null,
        { postgres: true, redis: true, migrations: true },
        {
          db: measured("up", "postgres"),
          redis: measured("up", "redis")
        }
      )
    )
    expect(ping).toHaveBeenCalledTimes(1)
  })

  it("degrades at the shared deadline when a configured Redis probe hangs", async () => {
    vi.useFakeTimers()
    const check = createHealthCheck({ ...ready, redis: () => new Promise<boolean>(() => {}) })
    const pending = check()
    await vi.advanceTimersByTimeAsync(4000)
    expect(await pending).toEqual(
      body(
        "degraded",
        null,
        { postgres: true, redis: false, migrations: true },
        {
          db: measured("up", "postgres"),
          redis: unmeasured("redis")
        }
      )
    )
  })
})

describe("migration readiness", () => {
  it("returns HTTP 503 when database and cache work but migrations are not ready", async () => {
    const url = await serve(
      createHealthCheck(
        { postgres: async () => [{ ok: 1 }], redis: async () => true, migrations: async () => false },
        revision
      )
    )
    const response = await fetch(`${url}/health`)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual(
      body(
        "unavailable",
        revision,
        { postgres: true, redis: true, migrations: false },
        {
          db: measured("up", "postgres"),
          redis: measured("up", "redis")
        }
      )
    )
  })

  it("requires every local migration completed and no unresolved attempt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "altera-health-"))
    const done = { migration_name: "20260101_initial", finished_at: new Date(), rolled_back_at: null }
    try {
      await mkdir(join(directory, done.migration_name))
      expect(await checkMigrations(async () => [done], directory)).toBe(true)
      for (const rows of [
        [],
        [{ ...done, finished_at: null }],
        [{ ...done, rolled_back_at: new Date() }],
        [done, { ...done, finished_at: null }]
      ]) {
        expect(await checkMigrations(async () => rows, directory)).toBe(false)
      }
      expect(
        await checkMigrations(async () => [done, { ...done, finished_at: null, rolled_back_at: new Date() }], directory)
      ).toBe(true)
      await mkdir(join(directory, "20260102_pending"))
      expect(await checkMigrations(async () => [done], directory)).toBe(false)
      expect(
        await checkMigrations(async () => {
          throw new Error("missing table/private detail")
        }, directory)
      ).toBe(false)
      expect(await checkMigrations(async () => [done], join(directory, "missing"))).toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("loads committed migrations relative to the module and rejects an empty inventory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "altera-health-empty-"))
    const query = vi.fn(async () => [])
    try {
      expect(await checkMigrations(query)).toBe(false)
      expect(query).toHaveBeenCalledTimes(1)
      expect(await checkMigrations(query, directory)).toBe(false)
      expect(query).toHaveBeenCalledTimes(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("bounds hung migration checks within the shared four second deadline", async () => {
    vi.useFakeTimers()
    const migrations = vi.fn(() => new Promise<boolean>(() => {}))
    const check = createHealthCheck({ postgres: async () => [{ ok: 1 }], redis: async () => true, migrations })
    const first = check()
    await vi.advanceTimersByTimeAsync(4000)
    expect(await first).toEqual(
      body(
        "unavailable",
        null,
        { postgres: true, redis: true, migrations: false },
        {
          db: measured("up", "postgres"),
          redis: measured("up", "redis")
        }
      )
    )
    await vi.advanceTimersByTimeAsync(10000)
    expect((await check()).status).toBe("unavailable")
    expect(migrations).toHaveBeenCalledTimes(1)
  })
})
