import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import {
  createErrorCollector,
  createErrorCollectorAdapterFromEnv,
  createNoopErrorCollectorAdapter,
  errorSignature,
  normalizeStack,
  SIGNATURE_STACK_FRAMES,
  type ErrorCollectorAdapter,
  type ErrorGroup,
  type ErrorHistory,
  type ErrorOccurrence
} from "../src/error-collector"
import { createApiError, createErrorMasker } from "../src/errors/graphql-error"
import resolver from "../src/graphql/error-report/resolver"
import { createJobWorker, type ClaimedJob, type JobStore } from "../src/jobs/job-worker"
import type { LogEntry } from "../src/observability/logger"

/**
 * T-089: собственная история `backend.error` и внешний сборщик через адаптер
 * (`80-observability/error-collector.md` §2, §5; реестр событий #54, #64, #81).
 */

const REQUEST_ID = "5f0c2a4e-8b1d-4c3e-9a7f-1b2c3d4e5f60"

function createMemoryHistory(): ErrorHistory & { rows: ErrorOccurrence[] } {
  const rows: ErrorOccurrence[] = []
  return {
    rows,
    async append(occurrence) {
      rows.push(occurrence)
    },
    async listGroups(filter) {
      const groups = new Map<string, ErrorGroup>()
      for (const row of rows) {
        if (row.occurredAt < filter.since || row.occurredAt >= filter.until) continue
        if (filter.stream && row.stream !== filter.stream) continue
        const group = groups.get(row.signature)
        if (group) {
          group.occurrences += 1
          if (row.occurredAt < group.firstSeenAt) group.firstSeenAt = row.occurredAt
          if (row.occurredAt > group.lastSeenAt) group.lastSeenAt = row.occurredAt
        } else {
          groups.set(row.signature, {
            signature: row.signature,
            stream: row.stream,
            service: row.service,
            code: row.code,
            route: row.route,
            occurrences: 1,
            firstSeenAt: row.occurredAt,
            lastSeenAt: row.occurredAt
          })
        }
      }
      return [...groups.values()]
    }
  }
}

function createWorld(options: { adapter?: ErrorCollectorAdapter; history?: ErrorHistory } = {}) {
  const history = createMemoryHistory()
  const logs: LogEntry[] = []
  const logger = { log: (entry: LogEntry) => logs.push(entry) }
  let clock = new Date("2026-09-21T10:00:00.000Z")
  const collector = createErrorCollector({
    history: options.history ?? history,
    adapter: options.adapter ?? createNoopErrorCollectorAdapter(),
    logger,
    now: () => clock
  })
  const tick = (ms: number) => {
    clock = new Date(clock.getTime() + ms)
  }
  return { collector, history, logs, logger, tick }
}

const period = { since: new Date("2026-09-21T00:00:00.000Z"), until: new Date("2026-09-22T00:00:00.000Z") }

/** Повторяющийся сбой одного пути кода: стек задан явно, чтобы тест не зависел от кадров раннера. */
function failingResolver(): Error {
  const error = new Error("database connection reset")
  error.stack = [
    "Error: database connection reset",
    "    at loadFeed (/app/server/dist/feed.js:10:15)",
    "    at resolveFeed (/app/server/dist/resolver.js:4:9)"
  ].join("\n")
  return error
}

describe("T-089 page.error from the frontend", () => {
  it("writes a frontend page error into the history through the public mutation", async () => {
    const { collector, history } = createWorld()
    const ctx = { errorCollector: collector, requestId: "req-report" } as never

    const result = await resolver.Mutation.reportPageError(
      {},
      { route: "/articles/:slug()?utm=1#top", code: "500", requestId: REQUEST_ID },
      ctx
    )

    expect(result).toBe(true)
    expect(history.rows).toHaveLength(1)
    expect(history.rows[0]).toMatchObject({
      event: "page.error",
      stream: "page",
      service: "web",
      code: "500",
      route: "/articles/:slug()",
      requestId: REQUEST_ID,
      stack: null
    })
    const groups = await history.listGroups({ ...period, stream: "page" })
    expect(groups).toHaveLength(1)
    expect(groups[0]?.occurrences).toBe(1)
  })

  it("rejects fields outside the registry format with VALIDATION_ERROR and records nothing", async () => {
    const { collector, history } = createWorld()
    const ctx = { errorCollector: collector, requestId: "req-report" } as never

    const cases = [
      { route: "https://evil.example/x", code: "500", field: "route" },
      { route: `/${"a".repeat(300)}`, code: "500", field: "route" },
      { route: "/feed", code: "user@example.com", field: "code" },
      { route: "/feed", code: "500", requestId: "not-a-uuid", field: "requestId" }
    ]
    for (const { field, ...args } of cases) {
      const error = await resolver.Mutation.reportPageError({}, args, ctx).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(GraphQLError)
      expect((error as GraphQLError).extensions).toMatchObject({ code: "VALIDATION_ERROR", field, rule: "format" })
    }
    expect(history.rows).toHaveLength(0)
  })
})

describe("T-089 noop adapter", () => {
  it("is the default driver and the system works without an external service", async () => {
    for (const driver of [undefined, "", "noop"]) {
      expect(createErrorCollectorAdapterFromEnv({ ERROR_COLLECTOR_DRIVER: driver }).name).toBe("noop")
    }
    expect(createErrorCollectorAdapterFromEnv({ NODE_ENV: "production" }).name).toBe("noop")
    expect(() => createErrorCollectorAdapterFromEnv({ ERROR_COLLECTOR_DRIVER: "sentry" })).toThrow(
      "Unknown ERROR_COLLECTOR_DRIVER"
    )

    const { collector, history, logs } = createWorld({ adapter: createErrorCollectorAdapterFromEnv({}) })
    const maskError = createErrorMasker({
      logger: { log: () => undefined },
      requestIdFactory: () => REQUEST_ID,
      collector
    })
    const masked = maskError(new Error("boom"), "Unexpected error")

    await vi.waitFor(() => expect(history.rows).toHaveLength(1))
    expect(masked.extensions).toMatchObject({ code: "INTERNAL_ERROR", requestId: REQUEST_ID })
    expect(collector.adapter).toBe("noop")
    expect(logs).toHaveLength(0)
  })

  it("sends every recorded occurrence to the adapter", async () => {
    const sent: ErrorOccurrence[] = []
    const { collector, history } = createWorld({ adapter: { name: "spy", send: async (item) => void sent.push(item) } })

    await collector.capturePageError({ route: "/feed", code: "NETWORK" })
    await collector.capture({ event: "error.unhandled", service: "api", code: "INTERNAL_ERROR", requestId: REQUEST_ID })

    expect(sent).toEqual(history.rows)
    expect(sent).toHaveLength(2)
  })

  it("keeps the history when the external collector fails and logs the failure without recursion", async () => {
    const { collector, history, logs } = createWorld({
      adapter: {
        name: "broken",
        send: async () => {
          throw new Error("collector down")
        }
      }
    })

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
    expect(logs[0]).toMatchObject({ event: "backend.error", level: "error", requestId: REQUEST_ID })
  })

  it("does not throw when the history write fails", async () => {
    const { collector, logs } = createWorld({
      history: {
        append: async () => {
          throw new Error("db down")
        },
        listGroups: async () => []
      }
    })

    await expect(collector.capturePageError({ route: "/feed", code: "500" })).resolves.toMatchObject({
      event: "page.error"
    })
    expect(logs[0]).toMatchObject({ event: "backend.error", message: "Error history write failed" })
  })
})

describe("T-089 backend errors in the history", () => {
  it("records an unhandled resolver error with the requestId of the INTERNAL_ERROR response", async () => {
    const { collector, history } = createWorld()
    const maskError = createErrorMasker({
      logger: { log: () => undefined },
      requestIdFactory: () => REQUEST_ID,
      collector
    })
    const original = new Error("db failed for reader@example.com")
    const wrapped = new GraphQLError("db failed", { path: ["createArticle", 0, "title"], originalError: original })

    const masked = maskError(wrapped, "Unexpected error")

    await vi.waitFor(() => expect(history.rows).toHaveLength(1))
    expect(masked.extensions.requestId).toBe(REQUEST_ID)
    expect(history.rows[0]).toMatchObject({
      event: "error.unhandled",
      stream: "backend",
      service: "api",
      code: "INTERNAL_ERROR",
      route: "graphql:createArticle",
      requestId: REQUEST_ID,
      errorType: "Error"
    })
    // Без ПДн (§2 п. 5): адрес маскируется и в сообщении, и в стеке.
    expect(history.rows[0]?.message).toBe("db failed for [REDACTED]")
    expect(history.rows[0]?.stack).not.toContain("reader@example.com")
  })

  it("does not record dictionary errors", async () => {
    const { collector, history } = createWorld()
    const maskError = createErrorMasker({
      logger: { log: () => undefined },
      requestIdFactory: () => REQUEST_ID,
      collector
    })

    maskError(createApiError("FORBIDDEN", { requestId: REQUEST_ID, action: "article.edit" }), "Forbidden")
    await expect(
      collector.capture({
        event: "error.unhandled",
        service: "api",
        code: "VALIDATION_ERROR",
        requestId: REQUEST_ID,
        error: createApiError("VALIDATION_ERROR", { requestId: REQUEST_ID, field: "title", rule: "required" })
      })
    ).resolves.toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(history.rows).toHaveLength(0)
  })

  it("groups two identical failures into one group with two occurrences", async () => {
    const { collector, history, tick } = createWorld()
    const capture = () =>
      collector.capture({
        event: "error.unhandled",
        service: "api",
        code: "INTERNAL_ERROR",
        route: "graphql:feed",
        requestId: REQUEST_ID,
        error: failingResolver()
      })

    await capture()
    tick(60_000)
    await capture()
    await collector.capture({
      event: "error.unhandled",
      service: "api",
      code: "INTERNAL_ERROR",
      route: "graphql:article",
      requestId: REQUEST_ID,
      error: failingResolver()
    })

    const groups = await history.listGroups({ ...period, stream: "backend" })
    const feed = groups.find((group) => group.route === "graphql:feed")
    expect(groups).toHaveLength(2)
    expect(feed).toMatchObject({ occurrences: 2 })
    expect(feed!.lastSeenAt.getTime() - feed!.firstSeenAt.getTime()).toBe(60_000)
  })

  it("records a job that exhausted its attempts as job.failed from the worker", async () => {
    const { collector, history } = createWorld()
    const job: ClaimedJob = {
      id: "job-1",
      kind: "mail.send",
      parameters: {},
      attemptCount: 3,
      maxAttempts: 3,
      createdAt: new Date("2026-09-21T09:00:00.000Z"),
      startedAt: new Date("2026-09-21T09:00:01.000Z"),
      originRequestId: REQUEST_ID
    }
    const store = {
      claimNext: async () => job,
      complete: async () => undefined,
      reschedule: async () => undefined,
      fail: async () => true,
      markStuck: async () => []
    } as unknown as JobStore
    class MailTransportError extends Error {
      override name = "MailTransportError"
    }
    const worker = createJobWorker({
      store,
      logger: { log: () => undefined },
      handlers: new Map([
        [
          "mail.send",
          async () => {
            throw new MailTransportError("smtp refused")
          }
        ]
      ]),
      errorCollector: collector
    })

    await worker.processNext()

    expect(history.rows).toHaveLength(1)
    expect(history.rows[0]).toMatchObject({
      event: "job.failed",
      service: "worker",
      code: "MailTransportError",
      route: "mail.send",
      jobId: "job-1",
      requestId: REQUEST_ID
    })
  })
})

describe("T-089 signature", () => {
  it("drops line numbers, addresses and directories from the first stack frames", () => {
    const stack = [
      "Error: boom",
      "    at loadFeed (/opt/render/project/src/server/dist/feed.js:10:15)",
      "    at async Promise.all (index 0)",
      "    at C:\\build\\server\\dist\\resolver.js:3:7",
      "    at native 0x1f2e3d"
    ].join("\n")

    expect(normalizeStack(stack)).toEqual([
      "loadFeed (feed.js)",
      "async Promise.all (index 0)",
      "resolver.js",
      "native 0x"
    ])
    const moved = stack.replace("/opt/render/project/src", "/home/app").replace(":10:15", ":42:1")
    const parts = { stream: "backend", service: "api", code: "INTERNAL_ERROR", route: "graphql:feed" }
    expect(errorSignature({ ...parts, stack: moved })).toBe(errorSignature({ ...parts, stack }))
    expect(errorSignature({ ...parts, route: "graphql:article", stack })).not.toBe(errorSignature({ ...parts, stack }))
  })

  it("uses only the first frames", () => {
    const frames = Array.from({ length: SIGNATURE_STACK_FRAMES + 3 }, (_, index) => `    at f${index} (a.js:1:1)`)
    expect(normalizeStack(["Error", ...frames].join("\n"))).toHaveLength(SIGNATURE_STACK_FRAMES)
  })
})
