import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { LOG_EVENT_CODES, isLogEventCode, type LogEventCode } from "../src/observability/log-events"
import { createAppLogger, type LogEntry } from "../src/observability/logger"
import { createPiiHasher } from "../src/observability/privacy"

const expectedLogEvents = [
  "http.request",
  "auth.link.requested",
  "auth.login",
  "auth.login.failed",
  "session.refresh",
  "session.revoked",
  "session.reuse_detected",
  "rate_limit.hit",
  "translation.submit",
  "translation.withdraw",
  "translation.reedit",
  "ai.job.created",
  "ai.job.started",
  "ai.job.running",
  "ai.job.done",
  "ai.job.failed",
  "ranking.run.started",
  "ranking.run.done",
  "ranking.run.failed",
  "webhook.received",
  "webhook.processed",
  "webhook.failed",
  "subscription.activated",
  "subscription.deactivated",
  "subscription.expired",
  "subscription.renewed",
  "subscription.queued",
  "subscription.retry",
  "mail.queued",
  "mail.sent",
  "mail.failed",
  "job.failed",
  "job.stuck",
  "system.health",
  "error.unhandled",
  "plan.action.rejected",
  "support.request.created",
  "backend.error",
  "engagement.anomaly",
  "review.reply",
  "admin.enter"
] as const satisfies readonly LogEventCode[]

function createDestination() {
  const lines: string[] = []
  return {
    lines,
    write(line: string) {
      lines.push(line)
    }
  }
}

describe("structured logger", () => {
  it("contains every approved non-cancelled log event and rejects unknown events", () => {
    expect(LOG_EVENT_CODES).toEqual(expectedLogEvents)
    expect(isLogEventCode("error.unhandled")).toBe(true)
    expect(isLogEventCode("cache.hit")).toBe(false)

    const destination = createDestination()
    const logger = createAppLogger({ service: "api", environment: "test", destination })
    expect(() =>
      logger.log({
        level: "info",
        event: "cache.hit",
        message: "cache hit",
        requestId: "req-1"
      } as unknown as LogEntry)
    ).toThrow("Unknown log event")
    expect(destination.lines).toEqual([])
  })

  it("writes one JSON line with mandatory fields and exactly one correlation key", () => {
    const destination = createDestination()
    const logger = createAppLogger({
      service: "api",
      environment: "test",
      destination,
      now: () => new Date("2026-09-15T00:00:00.000Z")
    })

    logger.log({ level: "warn", event: "rate_limit.hit", message: "limited", requestId: "req-1" })

    expect(destination.lines).toHaveLength(1)
    expect(destination.lines[0]?.endsWith("\n")).toBe(true)
    expect(JSON.parse(destination.lines[0] ?? "")).toMatchObject({
      time: "2026-09-15T00:00:00.000Z",
      level: "warn",
      service: "api",
      environment: "test",
      event: "rate_limit.hit",
      requestId: "req-1",
      message: "limited"
    })
    expect(() =>
      logger.log({
        level: "info",
        event: "http.request",
        message: "bad",
        requestId: "req-1",
        jobId: "job-1"
      } as unknown as LogEntry)
    ).toThrow("exactly one correlation")
    expect(() => logger.log({ level: "info", event: "http.request", message: "bad" } as unknown as LogEntry)).toThrow(
      "exactly one correlation"
    )
  })

  it("redacts personal data and credentials before writing any log bytes", () => {
    const destination = createDestination()
    const logger = createAppLogger({ service: "api", environment: "test", destination })
    const email = "person@example.com"
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature"
    const error = new Error(`delivery failed for ${email}`)
    error.cause = { authorization: `Bearer ${jwt}`, nested: { email } }

    logger.log({
      level: "error",
      event: "error.unhandled",
      requestId: "req-2",
      message: `Failed for ${email} with Bearer ${jwt}`,
      data: {
        email,
        nested: { note: email, token: jwt },
        magicLink: `https://example.test/login?token=${jwt}`
      },
      error
    })

    const output = destination.lines.join("")
    expect(output).not.toContain(email)
    expect(output).not.toContain(jwt)
    expect(output).not.toContain("Bearer")
    expect(output).not.toContain("https://example.test/login")
    expect(output).toContain("[REDACTED]")
    expect(JSON.parse(output).error.stack).toContain("Error:")
  })
})

describe("PII hashing", () => {
  it("uses purpose-separated HMAC-SHA-256 for normalized e-mail and daily IP hashes", () => {
    const first = createPiiHasher("first-secret")
    const second = createPiiHasher("second-secret")
    const expectedEmail = createHmac("sha256", "first-secret").update("email:person@example.com").digest("hex")

    expect(first.email(" Person@Example.com ")).toBe(expectedEmail)
    expect(first.email("person@example.com")).toBe(expectedEmail)
    expect(second.email("person@example.com")).not.toBe(expectedEmail)
    expect(first.ip("203.0.113.1", "2026-09-15")).not.toBe(first.ip("203.0.113.1", "2026-09-16"))
  })

  it.each(["", "   "])("rejects an empty hash secret without echoing it", (secret) => {
    expect(() => createPiiHasher(secret)).toThrow("LOG_HASH_SECRET is required")
  })
})
