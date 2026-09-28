import { createServer, type IncomingHttpHeaders, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { GraphQLError } from "graphql"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createErrorCollector,
  createErrorCollectorAdapterFromEnv,
  createSentryErrorCollectorAdapter,
  ErrorCollectorDsnError,
  parseSentryDsn,
  sentryStackFrames,
  type ErrorCollectorAdapter,
  type ErrorGroup,
  type ErrorHistory,
  type ErrorOccurrence
} from "../src/error-collector"
import { createErrorMasker } from "../src/errors/graphql-error"
import type { LogEntry } from "../src/observability/logger"

/**
 * T-114: адаптер внешнего сборщика ошибок по Sentry-протоколу для собственного GlitchTip/Sentry
 * (журнал §34 п. 3; `80-observability/error-collector.md` §2 п. 2, 5). Стенд — локальный
 * `node:http` в роли ingest-эндпоинта: тест проверяет настоящий HTTP-запрос адаптера, выбранного
 * через окружение, а не подменённый транспорт.
 */

const REQUEST_ID = "5f0c2a4e-8b1d-4c3e-9a7f-1b2c3d4e5f60"
/** Публичный ключ DSN: право писать в проект сборщика, поэтому в теле запроса его быть не должно. */
const PUBLIC_KEY = "2f7c9a1b3e5d4f60"
const PROJECT_ID = "7"

interface IngestRequest {
  method: string | undefined
  path: string | undefined
  headers: IncomingHttpHeaders
  body: string
}

const servers: Server[] = []

afterEach(async () => {
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

/** Локальный сборщик: принимает envelope и отвечает так же, как ingest GlitchTip. */
async function startIngest(status = 200): Promise<{ origin: string; requests: IngestRequest[] }> {
  const requests: IngestRequest[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      requests.push({
        method: request.method,
        path: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8")
      })
      response.statusCode = status
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ id: "b".repeat(32) }))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests }
}

function createMemoryHistory(): ErrorHistory & { rows: ErrorOccurrence[] } {
  const rows: ErrorOccurrence[] = []
  return {
    rows,
    async append(occurrence) {
      rows.push(occurrence)
    },
    listGroups: async (): Promise<ErrorGroup[]> => []
  }
}

function createWorld(adapter: ErrorCollectorAdapter) {
  const history = createMemoryHistory()
  const logs: LogEntry[] = []
  const collector = createErrorCollector({
    history,
    adapter,
    logger: { log: (entry: LogEntry) => logs.push(entry) },
    now: () => new Date("2026-09-28T10:00:00.000Z")
  })
  return { collector, history, logs }
}

/** Разбор envelope: заголовок конверта, заголовок элемента и событие. */
function readEnvelope(body: string): {
  header: Record<string, unknown>
  itemHeader: Record<string, unknown>
  event: Record<string, unknown>
  payload: string
} {
  const [header, itemHeader, ...rest] = body.split("\n")
  const payload = rest.join("\n").replace(/\n$/, "")
  return {
    header: JSON.parse(header ?? "") as Record<string, unknown>,
    itemHeader: JSON.parse(itemHeader ?? "") as Record<string, unknown>,
    event: JSON.parse(payload) as Record<string, unknown>,
    payload
  }
}

describe("T-114 AC-1 ошибка сервера доходит до локального сборщика", () => {
  it("sends an unhandled resolver error as a Sentry envelope without personal data or secrets", async () => {
    const ingest = await startIngest()
    // Драйвер выбирается конфигурацией окружения — тем же вызовом, что в `src/server.ts`.
    const adapter = createErrorCollectorAdapterFromEnv({
      ERROR_COLLECTOR_DRIVER: "sentry",
      ERROR_COLLECTOR_DSN: `${ingest.origin.replace("http://", `http://${PUBLIC_KEY}@`)}/${PROJECT_ID}`,
      NODE_ENV: "production",
      RENDER_GIT_COMMIT: "a".repeat(40)
    })
    expect(adapter.name).toBe("sentry")

    const { collector, history, logs } = createWorld(adapter)
    const maskError = createErrorMasker({
      logger: { log: () => undefined },
      requestIdFactory: () => REQUEST_ID,
      collector
    })
    // ПДн и секреты в исходной ошибке: адрес, IP и токен входа должны быть замаскированы до
    // отправки (`logging-policy.md` п. 4, `error-collector.md` §2 п. 5).
    const original = new Error(`db failed for reader@example.com from 203.0.113.7 token ${"9".repeat(64)}`)
    original.stack = [
      `Error: db failed for reader@example.com from 203.0.113.7 token ${"9".repeat(64)}`,
      "    at loadFeed (/app/server/dist/feed.js:10:15)",
      "    at resolveFeed (/app/server/dist/resolver.js:4:9)"
    ].join("\n")
    const masked = maskError(
      new GraphQLError("db failed", { path: ["createArticle"], originalError: original }),
      "Unexpected error"
    )

    await vi.waitFor(() => expect(ingest.requests).toHaveLength(1))
    const request = ingest.requests[0]!
    expect(masked.extensions).toMatchObject({ code: "INTERNAL_ERROR", requestId: REQUEST_ID })
    // Отказов отправки не было: сбой адаптера писался бы в журнал как `backend.error`.
    expect(logs).toEqual([])

    expect(request.method).toBe("POST")
    expect(request.path).toBe(`/api/${PROJECT_ID}/envelope/`)
    expect(request.headers["content-type"]).toBe("application/x-sentry-envelope")
    expect(request.headers["x-sentry-auth"]).toBe(
      `Sentry sentry_version=7, sentry_client=altera-error-collector/1, sentry_key=${PUBLIC_KEY}`
    )

    const { header, itemHeader, event, payload } = readEnvelope(request.body)
    expect(header.event_id).toMatch(/^[0-9a-f]{32}$/)
    // `sent_at` — время отправки, а не время сбоя: у вхождения своё `timestamp`.
    expect(header.sent_at).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/)
    expect(itemHeader).toEqual({ type: "event", content_type: "application/json", length: Buffer.byteLength(payload) })

    expect(event).toMatchObject({
      event_id: header.event_id,
      timestamp: "2026-09-28T10:00:00.000Z",
      platform: "node",
      level: "error",
      logger: "api",
      environment: "production",
      release: "a".repeat(40),
      transaction: "graphql:createArticle",
      // Группировка внешнего сборщика совпадает с сигнатурой собственной истории (§2 п. 3).
      fingerprint: [history.rows[0]!.signature],
      tags: {
        stream: "backend",
        service: "api",
        code: "INTERNAL_ERROR",
        event: "error.unhandled",
        request_id: REQUEST_ID
      }
    })
    const exception = (event.exception as { values: { type: string; value: string; stacktrace?: unknown }[] })
      .values[0]!
    expect(exception.type).toBe("Error")
    expect(exception.value).toBe(history.rows[0]!.message)
    expect(exception.stacktrace).toEqual({
      frames: [
        { function: "resolveFeed", filename: "/app/server/dist/resolver.js", lineno: 4, colno: 9 },
        { function: "loadFeed", filename: "/app/server/dist/feed.js", lineno: 10, colno: 15 }
      ]
    })

    // Без ПДн и секретов: ни адреса, ни IP, ни токена, ни ключа DSN, ни строки подключения.
    for (const forbidden of ["reader@example.com", "203.0.113.7", "9".repeat(64), PUBLIC_KEY, "dsn"]) {
      expect(request.body).not.toContain(forbidden)
    }
    expect(request.body).toContain("[REDACTED]")
  })

  it("sends a frontend page error as a message event without a stack", async () => {
    const ingest = await startIngest()
    const { collector, logs } = createWorld(
      createSentryErrorCollectorAdapter({
        dsn: `${ingest.origin.replace("http://", `http://${PUBLIC_KEY}@`)}/${PROJECT_ID}`,
        environment: "development"
      })
    )

    await collector.capturePageError({ route: "/articles/:slug()", code: "500", requestId: REQUEST_ID })

    await vi.waitFor(() => expect(ingest.requests).toHaveLength(1))
    const { event } = readEnvelope(ingest.requests[0]!.body)
    expect(event).toMatchObject({
      logger: "web",
      environment: "development",
      transaction: "/articles/:slug()",
      message: { formatted: "500" },
      tags: { stream: "page", service: "web", code: "500", event: "page.error", request_id: REQUEST_ID }
    })
    expect(event.exception).toBeUndefined()
    expect(event.release).toBeUndefined()
    expect(logs).toEqual([])
  })
})

describe("T-114 отказ сборщика", () => {
  it("keeps the own history and logs backend.error when the collector rejects the event", async () => {
    const ingest = await startIngest(413)
    const { collector, history, logs } = createWorld(
      createSentryErrorCollectorAdapter({
        dsn: `${ingest.origin.replace("http://", `http://${PUBLIC_KEY}@`)}/${PROJECT_ID}`
      })
    )

    const occurrence = await collector.capture({
      event: "error.unhandled",
      service: "api",
      code: "INTERNAL_ERROR",
      requestId: REQUEST_ID,
      error: new Error("boom")
    })

    expect(occurrence).not.toBeNull()
    expect(history.rows).toHaveLength(1)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      event: "backend.error",
      level: "error",
      requestId: REQUEST_ID,
      message: "Error collector adapter failed",
      data: { adapter: "sentry" }
    })
  })

  it("keeps the own history when the collector is unreachable", async () => {
    const { collector, history, logs } = createWorld(
      // Неслушающий порт: отправка отказывает сразу, без ожидания сети.
      createSentryErrorCollectorAdapter({ dsn: `http://${PUBLIC_KEY}@127.0.0.1:1/${PROJECT_ID}` })
    )

    await collector.capturePageError({ route: "/feed", code: "NETWORK" })

    expect(history.rows).toHaveLength(1)
    expect(logs[0]).toMatchObject({ event: "backend.error", message: "Error collector adapter failed" })
  })
})

describe("T-114 DSN", () => {
  it("derives the envelope endpoint from the DSN", () => {
    expect(parseSentryDsn("https://key@errors.altera.test/12")).toMatchObject({
      envelopeUrl: "https://errors.altera.test/api/12/envelope/",
      publicKey: "key",
      projectId: "12"
    })
    expect(parseSentryDsn("http://key@localhost:28000/1").envelopeUrl).toBe("http://localhost:28000/api/1/envelope/")
    // Сборщик за префиксом пути и legacy-DSN с секретной частью: она не используется.
    expect(parseSentryDsn("https://key:legacy@errors.altera.test/collector/3").envelopeUrl).toBe(
      "https://errors.altera.test/collector/api/3/envelope/"
    )
  })

  it("rejects an unusable DSN without repeating its value", () => {
    const secret = "9f8e7d6c5b4a3210"
    const cases = [`not-a-url-${secret}`, `ftp://${secret}@errors.altera.test/1`, `https://errors.altera.test/1`]
    for (const dsn of cases) {
      const error = (() => {
        try {
          parseSentryDsn(dsn)
          return null
        } catch (caught: unknown) {
          return caught
        }
      })()
      expect(error).toBeInstanceOf(ErrorCollectorDsnError)
      expect((error as Error).message).not.toContain(secret)
    }
    // Проекта в адресе нет — событие уходить некуда.
    expect(() => parseSentryDsn(`https://${secret}@errors.altera.test`)).toThrow(ErrorCollectorDsnError)
  })
})

describe("T-114 кадры стека", () => {
  it("parses frames from oldest to newest and keeps windows paths whole", () => {
    const stack = [
      "Error: boom",
      "    at loadFeed (/app/server/dist/feed.js:10:15)",
      "    at C:\\build\\server\\dist\\resolver.js:3:7",
      "    at native"
    ].join("\n")

    // Кадр без скобок — это положение без имени функции: так его читает и Sentry SDK.
    expect(sentryStackFrames(stack)).toEqual([
      { filename: "native" },
      { filename: "C:\\build\\server\\dist\\resolver.js", lineno: 3, colno: 7 },
      { function: "loadFeed", filename: "/app/server/dist/feed.js", lineno: 10, colno: 15 }
    ])
    expect(sentryStackFrames(null)).toEqual([])
  })
})
