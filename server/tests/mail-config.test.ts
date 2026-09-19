import { describe, expect, it } from "vitest"
import { createMailConfigFromEnv } from "../src/mail/config"

const envelope = { from: "a@altera.test", to: "b@example.test", subject: "s", text: "t", html: "h" }

describe("mail transport configuration", () => {
  it("вне production без MAIL_TRANSPORT выбирает console", () => {
    const config = createMailConfigFromEnv({ NODE_ENV: "development" })
    expect(config.transport.name).toBe("console")
    expect(config.from).toBe("Altera <no-reply@localhost>")
  })

  it("в production не подставляет console неявно: отправка падает как недоступный провайдер", async () => {
    const config = createMailConfigFromEnv({ NODE_ENV: "production" })
    expect(config.transport.name).toBe("unconfigured")
    await expect(config.transport.send(envelope)).rejects.toMatchObject({ name: "MailTransportNotConfigured" })
  })

  it("в production допускает console только явно", () => {
    expect(createMailConfigFromEnv({ NODE_ENV: "production", MAIL_TRANSPORT: "console" }).transport.name).toBe(
      "console"
    )
  })

  it("запрещает fake в production и неизвестный транспорт", () => {
    expect(() => createMailConfigFromEnv({ NODE_ENV: "production", MAIL_TRANSPORT: "fake" })).toThrow(
      "MAIL_TRANSPORT=fake is not allowed in production"
    )
    expect(() => createMailConfigFromEnv({ MAIL_TRANSPORT: "sendmail" })).toThrow("Unknown MAIL_TRANSPORT")
  })

  it("собирает smtp из SMTP_HOST/SMTP_PORT и MAIL_FROM", () => {
    const config = createMailConfigFromEnv({
      MAIL_TRANSPORT: "smtp",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "21025",
      MAIL_FROM: "Altera <no-reply@altera.test>"
    })
    expect(config.transport.name).toBe("smtp")
    expect(config.from).toBe("Altera <no-reply@altera.test>")
  })

  it("требует корректную конфигурацию smtp", () => {
    expect(() => createMailConfigFromEnv({ MAIL_TRANSPORT: "smtp", SMTP_PORT: "21025" })).toThrow(
      "SMTP_HOST is required"
    )
    expect(() => createMailConfigFromEnv({ MAIL_TRANSPORT: "smtp", SMTP_HOST: "h", SMTP_PORT: "x" })).toThrow(
      "SMTP_PORT must be a port number"
    )
    expect(() =>
      createMailConfigFromEnv({ MAIL_TRANSPORT: "smtp", SMTP_HOST: "h", SMTP_PORT: "25", SMTP_USER: "u" })
    ).toThrow("SMTP_USER and SMTP_PASSWORD must be set together")
    expect(() =>
      createMailConfigFromEnv({ NODE_ENV: "production", MAIL_TRANSPORT: "smtp", SMTP_HOST: "h", SMTP_PORT: "25" })
    ).toThrow("MAIL_FROM is required in production")
  })

  it("console-транспорт ничего не доставляет и возвращает идентификатор", async () => {
    const config = createMailConfigFromEnv({})
    await expect(config.transport.send(envelope)).resolves.toEqual({
      messageId: expect.stringMatching(/^console-[0-9a-f-]{36}$/)
    })
  })
})
