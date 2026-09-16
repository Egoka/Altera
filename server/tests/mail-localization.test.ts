import { describe, expect, it } from "vitest"
import { createMagicLinkMessage } from "../src/mail/messages"

describe("локализация писем", () => {
  it.each([
    ["ru", "Ссылка входа в Altera", "Ваша одноразовая ссылка для входа", "Войти в Altera"],
    ["en", "Your Altera login link", "Your one-time sign-in link", "Sign in to Altera"]
  ] as const)("создаёт magic-link письмо на языке аккаунта: %s", (locale, subject, preheader, action) => {
    expect(createMagicLinkMessage(locale, "https://altera.example/auth/verify?token=secret")).toMatchObject({
      subject,
      preheader,
      text: expect.stringContaining(action),
      html: expect.stringContaining(action)
    })
  })
})
