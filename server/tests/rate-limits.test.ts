import { createHmac } from "node:crypto"
import { parse } from "graphql"
import { createSchema, createYoga } from "graphql-yoga"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { createErrorMasker } from "../src/errors/graphql-error"
import { createAppLogger, type AppLogger, type LogEntry } from "../src/observability/logger"
import { createPiiHasher } from "../src/observability/privacy"
import { createRequestTracingPlugin } from "../src/observability/request-tracing"
import {
  createRateLimiter,
  createRateLimitPlugin,
  createRateLimitStore,
  DatabaseRateLimitStore,
  middlewareRulesForField,
  RATE_LIMIT_BUCKETS,
  RATE_LIMIT_RULES,
  rateLimitRedisKey,
  resolveRateLimitAddress,
  rootFieldNames,
  type QueryDocument,
  type RateLimitBucket,
  type RateLimitCounterStore,
  type RateLimitDatabaseClient,
  type RateLimiter
} from "../src/rate-limits"
import { RedisRateLimitStore, type RateLimitRedisClient } from "../src/rate-limits/redis-store"
import { createMemoryRateLimitStore, createTestRateLimiter } from "./helpers/rate-limit"

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const entries: LogEntry[] = []
const collectingLogger: AppLogger = { log: (entry) => void entries.push(entry) }

const limiterWith = (options: { now?: () => Date; store?: RateLimitCounterStore } = {}): RateLimiter =>
  createTestRateLimiter({ logger: collectingLogger, ...options })

describe("единые пороги корзин", () => {
  /**
   * Независимая расшифровка таблицы `docs/spec/50-access/rate-limits.md` §2: числа переписаны с
   * пунктов спецификации, а не из модуля. Расхождение значит, что порог поменяли в коде мимо
   * спецификации — либо что спецификация поменялась и реестр за ней не пошёл.
   */
  const specThresholds: Record<RateLimitBucket, { limit: number; windowSeconds: number }> = {
    "auth.link.email": { limit: 5, windowSeconds: HOUR },
    "auth.link.ip": { limit: 20, windowSeconds: HOUR },
    "auth.verify.ip": { limit: 10, windowSeconds: HOUR },
    "contact.ip": { limit: 3, windowSeconds: HOUR },
    "contact.user": { limit: 10, windowSeconds: DAY },
    "search.ip": { limit: 60, windowSeconds: MINUTE },
    "search.user": { limit: 300, windowSeconds: MINUTE },
    "account.mutation.user": { limit: 60, windowSeconds: MINUTE },
    "account.email_change.user": { limit: 1, windowSeconds: DAY },
    "media.upload.user": { limit: 30, windowSeconds: HOUR },
    "admin.export.user": { limit: 10, windowSeconds: HOUR },
    "appeal.form.ip": { limit: 10, windowSeconds: HOUR }
  }

  it("повторяет пороги спецификации и не добавляет корзин с выдуманным числом", () => {
    expect([...RATE_LIMIT_BUCKETS].sort()).toEqual(Object.keys(specThresholds).sort())

    for (const bucket of RATE_LIMIT_BUCKETS) {
      const rule = RATE_LIMIT_RULES[bucket]
      expect({ limit: rule.limit, windowSeconds: rule.windowSeconds }).toEqual(specThresholds[bucket])
      expect(rule.source).toMatch(/^rate-limits\.md §2 п\. \d+$/)
    }
  })

  it("не даёт поднять порог во время работы процесса", () => {
    const rule = RATE_LIMIT_RULES["auth.link.email"]

    expect(() => {
      ;(rule as { limit: number }).limit = 1000
    }).toThrow(TypeError)
    expect(RATE_LIMIT_RULES["auth.link.email"].limit).toBe(5)
    expect(Object.isFrozen(RATE_LIMIT_RULES)).toBe(true)
  })

  it("отдаёт middleware только корзины по адресу", () => {
    expect(middlewareRulesForField("requestMagicLink").map(({ bucket }) => bucket)).toEqual(["auth.link.ip"])
    expect(middlewareRulesForField("verifyMagicLink").map(({ bucket }) => bucket)).toEqual(["auth.verify.ip"])
    expect(middlewareRulesForField("acceptConsent").map(({ bucket }) => bucket)).toEqual(["auth.verify.ip"])
    expect(middlewareRulesForField("createSupportRequest").map(({ bucket }) => bucket)).toEqual(["contact.ip"])
    expect(middlewareRulesForField("me")).toEqual([])

    for (const rule of Object.values(RATE_LIMIT_RULES)) {
      if (rule.middlewareFields.length > 0) expect(rule.keyKind).toBe("ip")
    }
  })
})

describe("применение лимита", () => {
  it("пропускает порог обращений и отвечает RATE_LIMITED на следующем", async () => {
    entries.length = 0
    const at = new Date("2026-09-21T10:00:00.000Z")
    const limiter = limiterWith({ now: () => at })
    const rule = RATE_LIMIT_RULES["auth.link.email"]

    for (let attempt = 1; attempt <= rule.limit; attempt += 1) {
      const decision = await limiter.enforce("auth.link.email", "reader@example.test", { requestId: "req-1" })
      expect(decision).toEqual({ allowed: true, remaining: rule.limit - attempt, retryAfter: HOUR })
    }

    await expect(
      limiter.enforce("auth.link.email", "reader@example.test", { requestId: "req-1" })
    ).rejects.toMatchObject({ extensions: { code: "RATE_LIMITED", requestId: "req-1", retryAfter: HOUR } })
  })

  it("пишет rate_limit.hit с корзиной и хэшем адреса, без адреса в открытом виде", async () => {
    entries.length = 0
    const at = new Date("2026-09-21T10:00:00.000Z")
    // Настоящий хэшер, а не двойник: проверяется, что в лог уходит именно соль дня, а не адрес.
    const piiHasher = createPiiHasher("t024-test-secret")
    const limiter = createRateLimiter({
      store: createMemoryRateLimitStore(),
      logger: collectingLogger,
      piiHasher,
      now: () => at
    })

    await limiter.enforce("account.email_change.user", "user-1", { requestId: "req-2", ip: "203.0.113.7" })
    await expect(
      limiter.enforce("account.email_change.user", "user-1", { requestId: "req-2", ip: "203.0.113.7" })
    ).rejects.toThrow()

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      level: "warn",
      event: "rate_limit.hit",
      requestId: "req-2",
      data: { bucket: "account.email_change.user", ipHash: piiHasher.ip("203.0.113.7", "2026-09-21") }
    })
    expect(JSON.stringify(entries[0])).not.toContain("203.0.113.7")
    // Соль дня действительно применяется: хэш того же адреса за другой день другой.
    expect(piiHasher.ip("203.0.113.7", "2026-09-22")).not.toBe(piiHasher.ip("203.0.113.7", "2026-09-21"))
  })

  it("оставляет ipHash пустым у корзины без адреса", async () => {
    entries.length = 0
    const limiter = limiterWith()

    await limiter.enforce("account.email_change.user", "user-2", { requestId: "req-3" })
    await expect(limiter.enforce("account.email_change.user", "user-2", { requestId: "req-3" })).rejects.toThrow()

    expect(entries[0]).toMatchObject({ data: { bucket: "account.email_change.user", ipHash: null } })
  })

  it("считает ключи независимо и хранит их обезличенными", async () => {
    const consume = vi.fn(async () => ({ hits: 1, resetAt: new Date("2026-09-21T11:00:00.000Z") }))
    const store: RateLimitCounterStore = { mode: "database", consume }
    const limiter = createRateLimiter({
      store,
      logger: collectingLogger,
      piiHasher: createPiiHasher("t024-test-secret"),
      now: () => new Date("2026-09-21T10:00:00.000Z")
    })

    await limiter.enforce("auth.link.email", "reader@example.test", { requestId: "req-4" })
    await limiter.enforce("auth.link.email", "other@example.test", { requestId: "req-4" })

    const keys = consume.mock.calls.map((call) => (call as unknown as [string, string])[1])
    expect(keys[0]).not.toBe(keys[1])
    expect(keys.join(" ")).not.toContain("example.test")
    expect(keys.every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true)
  })

  it("начинает счёт заново после конца окна", async () => {
    let at = new Date("2026-09-21T10:00:00.000Z")
    const limiter = limiterWith({ now: () => at })

    await limiter.enforce("account.email_change.user", "user-3", { requestId: "req-5" })
    await expect(limiter.enforce("account.email_change.user", "user-3", { requestId: "req-5" })).rejects.toThrow()

    at = new Date("2026-09-22T10:00:01.000Z")
    await expect(limiter.enforce("account.email_change.user", "user-3", { requestId: "req-5" })).resolves.toMatchObject(
      { allowed: true }
    )
  })

  it("округляет retryAfter вверх и не отдаёт ноль", async () => {
    let at = new Date("2026-09-21T10:00:00.000Z")
    const limiter = limiterWith({ now: () => at })

    await limiter.enforce("account.mutation.user", "user-4", { requestId: "req-6" })
    at = new Date("2026-09-21T10:00:59.900Z")

    await expect(limiter.enforce("account.mutation.user", "user-4", { requestId: "req-6" })).resolves.toMatchObject({
      retryAfter: 1
    })
  })
})

describe("лимит не зависит от роли", () => {
  /**
   * Критерий 2 задачи и правило журнала #57: персональных исключений нет. Проверяется и
   * поведением, и подписью: в применение лимита роль передать нечем.
   */
  it("упирается в один и тот же порог у гостя и у owner", async () => {
    const at = new Date("2026-09-21T10:00:00.000Z")
    const limiter = limiterWith({ now: () => at })
    const rule = RATE_LIMIT_RULES["auth.verify.ip"]

    const hitsUntilLimited = async (key: string) => {
      let allowed = 0
      for (let attempt = 0; attempt < rule.limit + 5; attempt += 1) {
        try {
          await limiter.enforce("auth.verify.ip", key, { requestId: "req-role", ip: key })
          allowed += 1
        } catch {
          return allowed
        }
      }
      return allowed
    }

    // Один и тот же адрес, две «роли»: у корзины по адресу роли нет вовсе, поэтому разные
    // ключи здесь изображают гостя и владельца, пришедших с разных адресов.
    expect(await hitsUntilLimited("198.51.100.1")).toBe(rule.limit)
    expect(await hitsUntilLimited("198.51.100.2")).toBe(rule.limit)
  })

  it("не различает служебную роль: та же корзина аккаунта упирается в тот же порог", async () => {
    const at = new Date("2026-09-21T10:00:00.000Z")
    const limiter = limiterWith({ now: () => at })
    const rule = RATE_LIMIT_RULES["admin.export.user"]

    // Ключом корзины аккаунта служит идентификатор, а не роль: `owner` и `analyst` проходят
    // одинаковое число обращений, и снять лимит роли нечем — применение роль не принимает.
    for (const actor of ["owner-1", "analyst-1"]) {
      for (let attempt = 0; attempt < rule.limit; attempt += 1) {
        await expect(limiter.enforce("admin.export.user", actor, { requestId: "req-role" })).resolves.toMatchObject({
          allowed: true
        })
      }
      await expect(limiter.enforce("admin.export.user", actor, { requestId: "req-role" })).rejects.toMatchObject({
        extensions: { code: "RATE_LIMITED" }
      })
    }
  })
})

describe("middleware корзин по адресу", () => {
  const schema = createSchema({
    typeDefs: /* GraphQL */ `
      type MagicLinkRequestResult {
        ok: Boolean!
      }
      type Query {
        me: String
      }
      type Mutation {
        requestMagicLink(email: String!): MagicLinkRequestResult!
        verifyMagicLink(token: String!): String
      }
    `,
    resolvers: {
      Query: { me: () => "reader" },
      Mutation: {
        requestMagicLink: () => {
          resolverCalls += 1
          return { ok: true }
        },
        verifyMagicLink: () => {
          resolverCalls += 1
          return "authenticated"
        }
      }
    }
  })

  let resolverCalls = 0

  const maskerLogger = createAppLogger({
    service: "api",
    environment: "test",
    destination: { write: () => undefined }
  })

  const yogaFor = (options: { ip: string | null; forwarded: boolean; limiter: RateLimiter }) =>
    createYoga({
      schema,
      logging: false,
      maskedErrors: { maskError: createErrorMasker({ logger: maskerLogger, requestIdFactory: () => "req-plugin" }) },
      context: () => ({
        requestId: "req-plugin",
        requestMeta: { ip: options.ip },
        rateLimiter: options.limiter
      }),
      plugins: [createRateLimitPlugin({ forwardedByBff: () => options.forwarded })]
    })

  const post = async (yoga: ReturnType<typeof yogaFor>, query: string) => {
    const response = await yoga.fetch("http://localhost/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query })
    })
    return (await response.json()) as {
      data?: Record<string, unknown> | null
      errors?: Array<{ message: string; extensions?: Record<string, unknown> }>
    }
  }

  it("отвечает RATE_LIMITED из словаря и не доходит до резолвера", async () => {
    resolverCalls = 0
    const at = new Date("2026-09-21T10:00:00.000Z")
    const yoga = yogaFor({ ip: "203.0.113.10", forwarded: true, limiter: limiterWith({ now: () => at }) })
    const rule = RATE_LIMIT_RULES["auth.link.ip"]

    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      const passed = await post(yoga, 'mutation { requestMagicLink(email: "reader@example.test") { ok } }')
      expect(passed.errors).toBeUndefined()
    }
    expect(resolverCalls).toBe(rule.limit)

    const limited = await post(yoga, 'mutation { requestMagicLink(email: "reader@example.test") { ok } }')

    expect(limited.errors).toEqual([
      { message: "Rate limit exceeded", extensions: { code: "RATE_LIMITED", retryAfter: HOUR } }
    ])
    // Проверка идёт до резолвера: письмо не уходит и запись не создаётся.
    expect(resolverCalls).toBe(rule.limit)
  })

  it("не лимитирует поля без корзины по адресу", async () => {
    const yoga = yogaFor({ ip: "203.0.113.11", forwarded: true, limiter: limiterWith() })

    for (let attempt = 0; attempt < RATE_LIMIT_RULES["auth.link.ip"].limit + 5; attempt += 1) {
      const result = await post(yoga, "query { me }")
      expect(result.data).toEqual({ me: "reader" })
    }
  })

  it("считает запрос мимо BFF в общей корзине, а не мимо лимита", async () => {
    const store = createMemoryRateLimitStore()
    const consume = vi.spyOn(store, "consume")
    const yoga = yogaFor({ ip: "203.0.113.12", forwarded: false, limiter: limiterWith({ store }) })

    await post(yoga, 'mutation { verifyMagicLink(token: "t") }')

    expect(consume).toHaveBeenCalledTimes(1)
    const [bucket] = consume.mock.calls[0] as unknown as [string]
    expect(bucket).toBe("auth.verify.ip")
  })

  it("не применяет корзину по адресу к петлевому вызову доверенного BFF", async () => {
    const store = createMemoryRateLimitStore()
    const consume = vi.spyOn(store, "consume")
    const yoga = yogaFor({ ip: "127.0.0.1", forwarded: true, limiter: limiterWith({ store }) })

    for (let attempt = 0; attempt < RATE_LIMIT_RULES["auth.verify.ip"].limit + 5; attempt += 1) {
      const result = await post(yoga, 'mutation { verifyMagicLink(token: "t") }')
      expect(result.errors).toBeUndefined()
    }
    expect(consume).not.toHaveBeenCalled()
  })
})

describe("middleware вместе с трассировкой запроса", () => {
  /**
   * Боевая связка: признак доверия берётся из состояния трассировки, а не передаётся тестом.
   * Проверяется, что состояние доступно внутри `onExecute` — иначе middleware считало бы
   * доверенным запрос, пришедший мимо BFF, и наоборот.
   */
  const forwardedRequestSecret = "t024-forward-secret"
  const requestId = "44444444-4444-4444-8444-444444444444"

  const yogaFor = (limiter: RateLimiter, ip: string) =>
    createYoga({
      schema: createSchema({
        typeDefs: /* GraphQL */ `
          type Mutation {
            verifyMagicLink(token: String!): String
          }
          type Query {
            me: String
          }
        `,
        resolvers: { Query: { me: () => "reader" }, Mutation: { verifyMagicLink: () => "authenticated" } }
      }),
      graphqlEndpoint: "/",
      logging: false,
      maskedErrors: {
        maskError: createErrorMasker({
          logger: createAppLogger({ service: "api", environment: "test", destination: { write: () => undefined } }),
          requestIdFactory: () => "req-traced"
        })
      },
      context: () => ({ requestId: "req-traced", requestMeta: { ip }, rateLimiter: limiter }),
      plugins: [
        createRequestTracingPlugin({
          logger: createAppLogger({ service: "api", environment: "test", destination: { write: () => undefined } }),
          forwardedRequestSecret
        }),
        createRateLimitPlugin()
      ]
    })

  const post = async (yoga: ReturnType<typeof yogaFor>, signed: boolean) => {
    const headers: Record<string, string> = { "content-type": "application/json", "x-graphql-yoga-csrf": "bff" }
    if (signed) {
      headers["x-request-id"] = requestId
      headers["x-request-id-signature"] = createHmac("sha256", forwardedRequestSecret).update(requestId).digest("hex")
    }
    const response = await yoga.fetch("http://localhost/", {
      method: "POST",
      headers,
      body: JSON.stringify({ query: 'mutation { verifyMagicLink(token: "t") }' })
    })
    return (await response.json()) as { errors?: Array<{ extensions?: Record<string, unknown> }> }
  }

  it("верит адресу подписанного запроса и лимитирует его корзину", async () => {
    const store = createMemoryRateLimitStore()
    const consume = vi.spyOn(store, "consume")
    const yoga = yogaFor(limiterWith({ store }), "203.0.113.30")
    const rule = RATE_LIMIT_RULES["auth.verify.ip"]

    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      expect((await post(yoga, true)).errors).toBeUndefined()
    }
    expect((await post(yoga, true)).errors?.[0]?.extensions).toEqual({ code: "RATE_LIMITED", retryAfter: HOUR })

    const keys = consume.mock.calls.map((call) => (call as unknown as [string, string])[1])
    expect(new Set(keys).size).toBe(1)
  })

  it("не считает петлевой адрес подписанного запроса клиентской корзиной", async () => {
    const store = createMemoryRateLimitStore()
    const consume = vi.spyOn(store, "consume")
    const yoga = yogaFor(limiterWith({ store }), "127.0.0.1")

    for (let attempt = 0; attempt < RATE_LIMIT_RULES["auth.verify.ip"].limit + 3; attempt += 1) {
      expect((await post(yoga, true)).errors).toBeUndefined()
    }
    expect(consume).not.toHaveBeenCalled()
  })

  it("не верит петлевому адресу без подписи и считает такой вызов в общей корзине", async () => {
    const store = createMemoryRateLimitStore()
    const consume = vi.spyOn(store, "consume")
    const yoga = yogaFor(limiterWith({ store }), "127.0.0.1")
    const rule = RATE_LIMIT_RULES["auth.verify.ip"]

    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      expect((await post(yoga, false)).errors).toBeUndefined()
    }
    expect((await post(yoga, false)).errors?.[0]?.extensions).toEqual({ code: "RATE_LIMITED", retryAfter: HOUR })
    expect(consume).toHaveBeenCalledTimes(rule.limit + 1)
  })
})

describe("разбор адреса", () => {
  it.each([
    ["203.0.113.5", true, { kind: "client", key: "203.0.113.5" }],
    ["127.0.0.1", true, { kind: "internal" }],
    ["::1", true, { kind: "internal" }],
    ["::ffff:127.0.0.1", true, { kind: "internal" }],
    ["203.0.113.5", false, { kind: "unverified", key: "unverified" }],
    [null, true, { kind: "unverified", key: "unverified" }],
    ["not-an-address", true, { kind: "unverified", key: "unverified" }]
  ] as const)("адрес %s при доверии %s", (ip, forwarded, expected) => {
    expect(resolveRateLimitAddress(ip, forwarded)).toEqual(expected)
  })
})

describe("корневые поля операции", () => {
  it("читает названную операцию и раскрывает фрагмент верхнего уровня", () => {
    const document = parse(`
      fragment LoginFields on Mutation { requestMagicLink(email: "a@b.test") { ok } }
      mutation Login { ...LoginFields }
      mutation Verify { verifyMagicLink(token: "t") }
    `)

    const query = document as unknown as QueryDocument
    expect(rootFieldNames(query, "Login")).toEqual(["requestMagicLink"])
    expect(rootFieldNames(query, "Verify")).toEqual(["verifyMagicLink"])
    expect(rootFieldNames(query)).toEqual(["requestMagicLink"])
    expect(rootFieldNames(query, "Missing")).toEqual([])
  })
})

describe("хранилище счётчиков", () => {
  const databaseClient = (rows: unknown[] = [{ hits: 1, expiresAt: new Date("2026-09-21T11:00:00.000Z") }]) => ({
    $queryRaw: vi.fn(async () => rows),
    $executeRaw: vi.fn(async () => 3)
  })

  it("без REDIS_URL работает на таблице", () => {
    const store = createRateLimitStore({ client: databaseClient() as unknown as RateLimitDatabaseClient })

    expect(store.mode).toBe("database")
    expect(store).toBeInstanceOf(DatabaseRateLimitStore)
  })

  it("учитывает попадание одним выражением и приводит bigint из PostgreSQL", async () => {
    const client = databaseClient([{ hits: 7n, expiresAt: new Date("2026-09-21T11:00:00.000Z") }])
    const store = new DatabaseRateLimitStore(client as unknown as RateLimitDatabaseClient)

    const window = await store.consume("auth.link.ip", "key-1", HOUR, new Date("2026-09-21T10:00:00.000Z"))

    expect(client.$queryRaw).toHaveBeenCalledTimes(1)
    expect(window).toEqual({ hits: 7, resetAt: new Date("2026-09-21T11:00:00.000Z") })
  })

  it("удаляет только закрытые окна", async () => {
    const client = databaseClient()
    const store = new DatabaseRateLimitStore(client as unknown as RateLimitDatabaseClient)

    await expect(store.pruneExpired(new Date("2026-09-21T10:00:00.000Z"))).resolves.toBe(3)
    expect(client.$executeRaw).toHaveBeenCalledTimes(1)
  })

  it("падает, а не занижает счёт, если выражение не вернуло строку", async () => {
    const store = new DatabaseRateLimitStore(databaseClient([]) as unknown as RateLimitDatabaseClient)

    await expect(store.consume("auth.link.ip", "key-2", HOUR, new Date())).rejects.toThrow(
      "Rate limit counter did not return a row"
    )
  })
})

describe("счётчики Redis", () => {
  /** Эмулятор трёх команд скрипта: INCR, PTTL и PEXPIRE на одном ключе. */
  const fakeRedis = (): RateLimitRedisClient & { keys: Map<string, { hits: number; ttl: number }> } => {
    const keys = new Map<string, { hits: number; ttl: number }>()
    return {
      keys,
      on: () => undefined,
      quit: async () => undefined,
      async eval(_script, _keyCount, ...args) {
        const [key, ttlArg] = args
        const ttlMs = Number(ttlArg)
        const current = keys.get(key) ?? { hits: 0, ttl: -1 }
        current.hits += 1
        if (current.hits === 1 || current.ttl < 0) current.ttl = ttlMs
        keys.set(key, current)
        return [current.hits, current.ttl]
      }
    }
  }

  it("считает окно от первого попадания и не продлевает его следующими", async () => {
    const client = fakeRedis()
    const fallback = createMemoryRateLimitStore()
    const store = new RedisRateLimitStore(client, fallback)
    const now = new Date("2026-09-21T10:00:00.000Z")

    const first = await store.consume("auth.link.ip", "key-1", HOUR, now)
    const later = new Date("2026-09-21T10:30:00.000Z")
    const second = await store.consume("auth.link.ip", "key-1", HOUR, later)

    expect(store.mode).toBe("redis")
    expect(first).toEqual({ hits: 1, resetAt: new Date("2026-09-21T11:00:00.000Z") })
    // TTL остался тем же, поэтому конец окна отсчитывается от текущего момента тем же остатком.
    expect(second.hits).toBe(2)
    expect(client.keys.get(rateLimitRedisKey("auth.link.ip", "key-1"))).toEqual({ hits: 2, ttl: HOUR * 1000 })
  })

  it("объявляет ключ с версией и корзиной", () => {
    expect(rateLimitRedisKey("auth.link.email", "abc")).toBe("ratelimit:v1:auth.link.email:abc")
  })

  it("при сбое Redis продолжает счёт в таблице, а не снимает лимит", async () => {
    const failing: RateLimitRedisClient = {
      on: () => undefined,
      quit: async () => undefined,
      eval: async () => {
        throw new Error("redis down")
      }
    }
    const fallback = createMemoryRateLimitStore()
    const warnings: string[] = []
    const store = new RedisRateLimitStore(failing, fallback, (message) => warnings.push(message))
    const now = new Date("2026-09-21T10:00:00.000Z")

    expect(await store.consume("auth.link.ip", "key-2", HOUR, now)).toMatchObject({ hits: 1 })
    expect(await store.consume("auth.link.ip", "key-2", HOUR, now)).toMatchObject({ hits: 2 })
    expect(warnings).toEqual(["Redis rate limit counter failed", "Redis rate limit counter failed"])
  })
})

describe("запрос ссылки входа не раскрывает существование аккаунта", () => {
  let authMutations: typeof import("../src/graphql/auth/resolver").default.Mutation

  beforeAll(async () => {
    vi.stubEnv("JWT_ACCESS_SECRET", "t024-test-access-secret")
    ;({ Mutation: authMutations } = (await import("../src/graphql/auth/resolver")).default)
  })

  const world = (options: { known: boolean; limiter: RateLimiter }) => {
    const created: unknown[] = []
    const ctx = {
      prisma: {
        legalText: { findFirst: vi.fn().mockResolvedValue(null) },
        user: {
          findUnique: vi.fn(async () => (options.known ? { id: "user-1", locale: "ru" } : null)),
          create: vi.fn(async ({ data }: { data: unknown }) => {
            created.push(data)
            return { id: "user-new" }
          })
        },
        magicLinkToken: { upsert: vi.fn().mockResolvedValue({}) }
      },
      logger: collectingLogger,
      piiHasher: { email: (value: string) => `email(${value})`, ip: () => "ip-hash" },
      requestId: "req-login",
      requestMeta: { ip: "203.0.113.20" },
      rateLimiter: options.limiter,
      mail: { send: vi.fn().mockResolvedValue({ mailId: "mail-1", messageId: "<id>" }) }
    }
    return { ctx: ctx as never, created }
  }

  const request = (ctx: never, email: string) =>
    authMutations.requestMagicLink(null, { email, consentVersion: {}, locale: "ru" }, ctx)

  it("отвечает одинаково известному и неизвестному адресу на превышении порога", async () => {
    entries.length = 0
    const at = new Date("2026-09-21T10:00:00.000Z")
    const limiter = limiterWith({ now: () => at })
    const known = world({ known: true, limiter })
    const unknown = world({ known: false, limiter })
    const rule = RATE_LIMIT_RULES["auth.link.email"]

    const exhaust = async (target: { ctx: never }, email: string) => {
      for (let attempt = 0; attempt < rule.limit; attempt += 1) await request(target.ctx, email)
    }
    await exhaust(known, "known@example.test")
    await exhaust(unknown, "stranger@example.test")

    const knownError = await request(known.ctx, "known@example.test").catch((error: unknown) => error)
    const unknownError = await request(unknown.ctx, "stranger@example.test").catch((error: unknown) => error)

    const shape = (error: unknown) => {
      const { message, extensions } = error as { message: string; extensions: Record<string, unknown> }
      return { message, extensions }
    }
    expect(shape(knownError)).toEqual(shape(unknownError))
    expect(shape(knownError)).toEqual({
      message: "Rate limit exceeded",
      extensions: { code: "RATE_LIMITED", requestId: "req-login", retryAfter: HOUR }
    })
    // Перебор не заводит аккаунтов и не отличает ветки в логах.
    expect(unknown.created).toEqual([])
    expect(entries.filter(({ event }) => event === "rate_limit.hit")).toHaveLength(2)
  })

  it("показывает таймер повтора только когда окно израсходовано", async () => {
    const at = new Date("2026-09-21T10:00:00.000Z")
    const limiter = limiterWith({ now: () => at })
    const { ctx } = world({ known: true, limiter })
    const rule = RATE_LIMIT_RULES["auth.link.email"]

    for (let attempt = 1; attempt < rule.limit; attempt += 1) {
      await expect(request(ctx, "known@example.test")).resolves.toEqual({ ok: true, retryAfterSec: null })
    }

    await expect(request(ctx, "known@example.test")).resolves.toEqual({ ok: true, retryAfterSec: HOUR })
  })
})
