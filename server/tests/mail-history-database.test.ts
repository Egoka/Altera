import { randomUUID } from "node:crypto"
import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "../src/generated/prisma"
import { createMagicLinkMail, MAGIC_LINK_TEMPLATE } from "../src/mail/messages"
import { createMailService } from "../src/mail/service"
import { createFakeTransport } from "../src/mail/transports/fake"
import type { AppLogger } from "../src/observability/logger"

// База с уже применёнными миграциями (в CI — изолированная база job server-smoke).
const testDatabaseUrl = process.env.T021_TEST_DATABASE_URL
const stageOrder = ["queued", "sent", "failed"]

describe.skipIf(!testDatabaseUrl)("T-021 mail history in PostgreSQL", () => {
  const prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl })
  const logger: AppLogger = { log: () => undefined }
  const createdIds: string[] = []

  afterAll(async () => {
    await prisma.mailMessage.deleteMany({ where: { id: { in: createdIds } } })
    await prisma.$disconnect()
  })

  const send = async (fail: boolean) => {
    const transport = createFakeTransport()
    if (fail) transport.failWith(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }))
    const service = createMailService({ store: prisma, transport, logger, from: "Altera <no-reply@altera.test>" })
    const token = randomUUID().replace(/-/g, "").repeat(2)
    const to = `t021-${randomUUID()}@example.test`
    const { message, sanitizedBody } = createMagicLinkMail("ru", `https://altera.example/auth/verify?token=${token}`)
    const result = await service
      .send({ template: MAGIC_LINK_TEMPLATE, to, content: message, sanitizedBody, requestId: randomUUID() })
      .catch((error: unknown) => error)
    const stored = await prisma.mailMessage.findFirstOrThrow({
      where: { recipientEmail: to },
      include: { deliveryEvents: true }
    })
    createdIds.push(stored.id)
    // occurredAt хранится с точностью до миллисекунды, поэтому порядок задаётся стадией.
    stored.deliveryEvents.sort((a, b) => stageOrder.indexOf(a.status) - stageOrder.indexOf(b.status))
    return { result, stored, token, transport }
  }

  it("хранит отправленное письмо со статусом sent и событиями queued → sent без токена", async () => {
    const { stored, token, transport } = await send(false)

    expect(transport.sent[0]?.text).toContain(token)
    expect(stored).toMatchObject({
      template: "magic_link",
      subject: "Ссылка входа в Altera",
      status: "sent",
      provider: "fake",
      messageId: "fake-1",
      deliveryErrorClass: null
    })
    expect(stored.sentAt).toBeInstanceOf(Date)
    expect(stored.sanitizedBody).toContain("[секрет не показывается]")
    expect(stored.sanitizedBody).not.toContain(token)
    expect(stored.deliveryEvents.map(({ status, providerEventId }) => ({ status, providerEventId }))).toEqual([
      { status: "queued", providerEventId: null },
      { status: "sent", providerEventId: "fake-1" }
    ])
  })

  it("при ошибке транспорта хранит failed с классом ошибки и возвращает PROVIDER_UNAVAILABLE: mail", async () => {
    const { result, stored } = await send(true)

    expect(result).toMatchObject({ extensions: { code: "PROVIDER_UNAVAILABLE", provider: "mail" } })
    expect(stored).toMatchObject({ status: "failed", deliveryErrorClass: "ECONNREFUSED", sentAt: null })
    expect(stored.deliveryEvents.map(({ status, errorClass }) => ({ status, errorClass }))).toEqual([
      { status: "queued", errorClass: null },
      { status: "failed", errorClass: "ECONNREFUSED" }
    ])
  })
})
