import { expect, test } from "@playwright/test"
import { PrismaClient } from "../../../server/src/generated/prisma/index.js"

// T-021: письмо входа уходит через mail-модуль в локальный SMTP-приёмник (Mailpit)
// и записывается в историю писем; история проверяется прямым запросом к базе.
const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const mailpitUrl = process.env.T021_MAILPIT_URL ?? "http://127.0.0.1:28025"

interface MailpitSearch {
  messages: { ID: string; MessageID: string; Subject: string }[]
}

interface MailpitMessage {
  MessageID: string
  Subject: string
  Text: string
  HTML: string
}

test("magic-link письмо появляется в локальном приёмнике и в истории писем без токена", async ({ page, request }) => {
  const email = `t021-${Date.now()}@example.test`

  await page.goto("/", { waitUntil: "networkidle" })
  const response = await page.evaluate(async (address) => {
    const result = await fetch("/api/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "mutation ($email: String!, $locale: Locale!) { requestMagicLink(email: $email, locale: $locale) }",
        variables: { email: address, locale: "ru" }
      })
    })
    return { status: result.status, body: await result.json() }
  }, email)
  expect(response).toEqual({ status: 200, body: { data: { requestMagicLink: true } } })

  let found: MailpitSearch["messages"][number] | undefined
  await expect
    .poll(
      async () => {
        const search = await request.get(`${mailpitUrl}/api/v1/search`, { params: { query: `to:"${email}"` } })
        found = ((await search.json()) as MailpitSearch).messages[0]
        return found?.Subject
      },
      { timeout: 15_000 }
    )
    .toBe("Ссылка входа в Altera")

  const delivered = (await (await request.get(`${mailpitUrl}/api/v1/message/${found!.ID}`)).json()) as MailpitMessage
  const token = delivered.Text.match(/\/auth\/verify\?token=([0-9a-f]{64})/)?.[1]
  expect(token).toBeTruthy()

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  try {
    const history = await prisma.mailMessage.findMany({
      where: { recipientEmail: email },
      include: { deliveryEvents: true }
    })
    expect(history).toHaveLength(1)
    const [mail] = history
    expect(mail).toMatchObject({
      template: "magic_link",
      subject: "Ссылка входа в Altera",
      status: "sent",
      provider: "smtp"
    })
    expect(mail!.messageId?.replace(/^<|>$/g, "")).toBe(delivered.MessageID)
    expect(mail!.deliveryEvents.map((event) => event.status).sort()).toEqual(["queued", "sent"])
    expect(mail!.sanitizedBody).toContain("[секрет не показывается]")
    expect(mail!.sanitizedBody).not.toContain(token!)
    expect(mail!.sanitizedBody).not.toContain("token=")
  } finally {
    await prisma.$disconnect()
  }
})
