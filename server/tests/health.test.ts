import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createHealthCheck, withHealth } from "../src/health"
import { NoopCache } from "../src/cache/noop"
import { RedisCache, type CacheRedisClient } from "../src/cache/redis"

const revision = "a".repeat(40)
const servers: Server[] = []

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
    const client: CacheRedisClient = {
      on: () => client,
      ping: vi.fn(async () => "PONG"),
      get: async () => null,
      multi: () => {
        throw new Error("not used")
      },
      eval: async () => undefined,
      quit: async () => undefined
    }
    const cache = new RedisCache(client, 60)
    expect(await cache.isReady()).toBe(true)
    vi.mocked(client.ping).mockResolvedValue("LOADING")
    expect(await cache.isReady()).toBe(false)
    vi.mocked(client.ping).mockRejectedValue(new Error("private connection detail"))
    expect(await cache.isReady()).toBe(false)
    expect(await new NoopCache().isReady()).toBe(false)
  })
  it("serves actual dependency results and exact revision without changing GraphQL routing", async () => {
    const check = createHealthCheck({ postgres: async () => [{ ok: 1 }], redis: async () => true }, revision)
    const url = await serve(check)
    const response = await fetch(`${url}/health?probe=1`)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ status: "ok", revision, checks: { postgres: true, redis: true } })
    expect((await fetch(`${url}/`)).status).toBe(418)
    expect((await fetch(`${url}/health`, { method: "POST" })).status).toBe(418)
  })

  it("returns 503 and no driver errors or invalid revision", async () => {
    const check = createHealthCheck(
      {
        postgres: async () => {
          throw new Error("postgresql://user:private-value@host/db")
        },
        redis: async () => false
      },
      "private-invalid-revision"
    )
    const url = await serve(check)
    const response = await fetch(`${url}/health`)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      status: "unavailable",
      revision: null,
      checks: { postgres: false, redis: false }
    })
  })

  it("requires SELECT 1 result instead of accepting arbitrary successful query output", async () => {
    const check = createHealthCheck({ postgres: async () => [{ ok: 0 }], redis: async () => true })
    expect(await check()).toEqual({ status: "unavailable", revision: null, checks: { postgres: false, redis: true } })
  })

  it("shares concurrent probes and caches completed results for two seconds", async () => {
    vi.useFakeTimers()
    const postgres = vi.fn(async () => [{ ok: 1 }])
    const redis = vi.fn(async () => true)
    const check = createHealthCheck({ postgres, redis }, revision)
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
    const check = createHealthCheck({ postgres, redis })
    const pending = check()
    await vi.advanceTimersByTimeAsync(4000)
    expect(await pending).toEqual({ status: "unavailable", revision: null, checks: { postgres: false, redis: true } })
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
