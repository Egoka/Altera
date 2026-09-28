import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import { API_HEALTH_TIMEOUT_MS, readApiHealth, readRevision, readWebHealth } from "../server/utils/health"

// T-088: `/health` в Nuxt (реестр маршрутов #64, ADR-0032 п. 5) отдаёт состояние веба и ответ API
// с зависимостями и возрастом резервных копий. Публичной страницы статуса нет (журнал §20.16):
// это служебный маршрут без данных пользователя, без ПДн и без секретов.

const apiHealth = {
  status: "ok",
  revision: "a".repeat(40),
  checkedAt: "2026-09-28T12:00:00.000Z",
  checks: { postgres: true, redis: true, migrations: true },
  components: {
    db: { status: "up", adapter: "postgres", latencyMs: 2 },
    redis: { status: "up", adapter: "redis", latencyMs: 1 },
    psp: { status: "disabled", adapter: null, latencyMs: null },
    ai: { status: "disabled", adapter: null, latencyMs: null },
    mail: { status: "up", adapter: "smtp", latencyMs: 4 },
    storage: { status: "up", adapter: "s3", latencyMs: 8 }
  },
  backups: {
    database: { status: "ok", lastSuccessAt: "2026-09-28T03:00:00.000Z", ageSeconds: 32_400, maxAgeSeconds: 86_400 },
    media: { status: "ok", lastSuccessAt: "2026-09-22T03:00:00.000Z", ageSeconds: 550_800, maxAgeSeconds: 604_800 }
  }
}

const now = () => new Date("2026-09-28T12:00:05.000Z")

describe("состояние веба и API", () => {
  it("переносит зависимости и возраст копий из ответа API", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: apiHealth }))
    const health = await readWebHealth({
      apiHealthUrl: "http://127.0.0.1:4000/health",
      fetchJson,
      commit: "b".repeat(40),
      now
    })

    expect(health).toEqual({
      service: "web",
      status: "ok",
      revision: "b".repeat(40),
      checkedAt: "2026-09-28T12:00:05.000Z",
      api: { reachable: true, httpStatus: 200, health: apiHealth }
    })
    expect(fetchJson).toHaveBeenCalledWith("http://127.0.0.1:4000/health", { signal: expect.any(AbortSignal) })
  })

  it("деградация и недоступность API попадают в статус веба", async () => {
    const degraded = await readWebHealth({
      apiHealthUrl: "http://127.0.0.1:4000/health",
      fetchJson: async () => ({ status: 200, body: { ...apiHealth, status: "degraded" } }),
      now
    })
    expect(degraded.status).toBe("degraded")
    expect(degraded.api.reachable).toBe(true)

    const unavailable = await readWebHealth({
      apiHealthUrl: "http://127.0.0.1:4000/health",
      fetchJson: async () => ({ status: 503, body: { ...apiHealth, status: "unavailable" } }),
      now
    })
    expect(unavailable.status).toBe("unavailable")
    expect(unavailable.api.httpStatus).toBe(503)
  })

  it("отказ вызова API не роняет маршрут: веб отвечает и сообщает о недоступности", async () => {
    const health = await readWebHealth({
      apiHealthUrl: "http://127.0.0.1:4000/health",
      fetchJson: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:4000")
      },
      now
    })
    expect(health).toEqual({
      service: "web",
      status: "unavailable",
      revision: null,
      checkedAt: "2026-09-28T12:00:05.000Z",
      api: { reachable: false, httpStatus: null, health: null }
    })
    expect(JSON.stringify(health)).not.toContain("ECONNREFUSED")
  })

  it("ограничивает ожидание API собственным пределом проверки", async () => {
    let signal: AbortSignal | undefined
    await readWebHealth({
      apiHealthUrl: "http://127.0.0.1:4000/health",
      fetchJson: async (_url, init) => {
        signal = init.signal
        return { status: 200, body: apiHealth }
      },
      timeoutMs: 10,
      now
    })
    expect(API_HEALTH_TIMEOUT_MS).toBe(4000)
    expect(signal?.aborted).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(signal?.aborted).toBe(true)
  })
})

describe("контракт ответа API", () => {
  it.each([null, "ok", 42, [], {}, { status: "everything is fine" }])(
    "непонятый ответ API считается недоступностью: %j",
    (payload) => {
      expect(readApiHealth(payload)).toBeNull()
    }
  )

  it("переносит только известные поля и не пересказывает лишнее", () => {
    const parsed = readApiHealth({ ...apiHealth, secret: "smtp-password-value", checks: "нет" })
    expect(parsed).not.toBeNull()
    expect(Object.keys(parsed!).sort()).toEqual(["backups", "checkedAt", "checks", "components", "revision", "status"])
    expect(JSON.stringify(parsed)).not.toContain("smtp-password-value")
    expect(parsed?.checks).toEqual({})
  })

  it("ревизия деплоя — только валидный SHA", () => {
    expect(readRevision("c".repeat(40))).toBe("c".repeat(40))
    expect(readRevision("not-a-sha")).toBeNull()
    expect(readRevision(undefined)).toBeNull()
  })
})

describe("маршрут Nitro", () => {
  const source = readFileSync(new URL("../server/routes/health.get.ts", import.meta.url), "utf8")

  it("отдаёт ответ без кеша и берёт адрес API из приватной конфигурации", () => {
    expect(source).toContain('setHeader(event, "cache-control", "no-store")')
    expect(source).toContain("useRuntimeConfig(event)")
    expect(source).toContain('new URL("/health", graphqlApiUrl)')
  })

  it("не меняет код ответа: недоступный API не должен ронять веб у площадки", () => {
    expect(source).not.toContain("setResponseStatus")
  })
})
