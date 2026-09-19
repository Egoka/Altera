import { describe, expect, it } from "vitest"
import { GraphQLError } from "graphql"
import { createFakeTransport } from "../src/mail/transports/fake"
import { createMailService } from "../src/mail/service"
import { createMemoryStore } from "./helpers/mail-memory-store"
import type { AppLogger, LogEntry } from "../src/observability/logger"

function createLogCollector() {
  const entries: LogEntry[] = []
  const logger: AppLogger = { log: (entry) => void entries.push(entry) }
  return { logger, entries }
}

const secretToken = "a".repeat(64)
const input = {
  template: "magic_link",
  to: "reader@example.test",
  content: {
    subject: "Ссылка входа в Altera",
    text: `Войти: https://altera.example/auth/verify?token=${secretToken}`,
    html: `<a href="https://altera.example/auth/verify?token=${secretToken}">Войти</a>`
  },
  sanitizedBody: "Войти: [секрет не показывается]",
  requestId: "req-1"
}

describe("mail service", () => {
  it("записывает письмо в историю, отправляет полное письмо и фиксирует queued → sent", async () => {
    const { store, messages } = createMemoryStore()
    const { logger, entries } = createLogCollector()
    const transport = createFakeTransport()
    const service = createMailService({ store, transport, logger, from: "Altera <no-reply@altera.test>" })

    const result = await service.send(input)

    expect(transport.sent).toEqual([
      {
        from: "Altera <no-reply@altera.test>",
        to: "reader@example.test",
        subject: input.content.subject,
        text: input.content.text,
        html: input.content.html
      }
    ])
    const stored = messages.get(result.mailId)
    expect(stored).toMatchObject({
      template: "magic_link",
      recipientEmail: "reader@example.test",
      subject: "Ссылка входа в Altera",
      sanitizedBody: "Войти: [секрет не показывается]",
      status: "sent",
      provider: "fake",
      messageId: result.messageId
    })
    expect(stored?.sentAt).toBeInstanceOf(Date)
    expect(stored?.events.map((event) => event.status)).toEqual(["queued", "sent"])
    expect(entries.map((entry) => entry.event)).toEqual(["mail.queued", "mail.sent"])
    expect(entries.every((entry) => "requestId" in entry && entry.requestId === "req-1")).toBe(true)
    expect(entries[1]?.data).toMatchObject({ template: "magic_link", status: "sent", messageId: result.messageId })
  })

  it("при недоступном транспорте фиксирует mail.failed и возвращает PROVIDER_UNAVAILABLE: mail", async () => {
    const { store, messages } = createMemoryStore()
    const { logger, entries } = createLogCollector()
    const transport = createFakeTransport()
    const failure = Object.assign(new Error("connect ECONNREFUSED reader@example.test"), { code: "ECONNREFUSED" })
    transport.failWith(failure)
    const service = createMailService({ store, transport, logger, from: "Altera <no-reply@altera.test>" })

    const error = await service.send(input).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GraphQLError)
    expect((error as GraphQLError).extensions).toEqual({
      code: "PROVIDER_UNAVAILABLE",
      requestId: "req-1",
      provider: "mail"
    })
    const [stored] = [...messages.values()]
    expect(stored).toMatchObject({ status: "failed", deliveryErrorClass: "ECONNREFUSED", provider: "fake" })
    expect(stored?.events).toEqual([{ status: "queued" }, { status: "failed", errorClass: "ECONNREFUSED" }])
    expect(entries.map((entry) => [entry.event, entry.level])).toEqual([
      ["mail.queued", "info"],
      ["mail.failed", "error"]
    ])
    expect(entries[1]?.data).toMatchObject({ template: "magic_link", status: "failed", errorClass: "ECONNREFUSED" })
  })

  it("не пишет в логи адрес получателя, тему и содержимое письма", async () => {
    const { store } = createMemoryStore()
    const { logger, entries } = createLogCollector()
    const transport = createFakeTransport()
    const service = createMailService({ store, transport, logger, from: "Altera <no-reply@altera.test>" })

    await service.send(input)
    transport.failWith(new Error("boom"))
    await service.send(input).catch(() => undefined)

    const serialized = JSON.stringify(entries)
    expect(serialized).not.toContain("reader@example.test")
    expect(serialized).not.toContain(secretToken)
    expect(serialized).not.toContain("Ссылка входа")
    expect(serialized).not.toContain("секрет не показывается")
  })
})
