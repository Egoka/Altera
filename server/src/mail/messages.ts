import type { Locale } from "../generated/prisma"

export interface MailMessage {
  subject: string
  preheader: string
  text: string
  html: string
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export const createMagicLinkMessage = (locale: Locale, url: string): MailMessage => {
  const escapedUrl = escapeHtml(url)

  if (locale === "en") {
    const body =
      "Hello,\n\nyou requested a login link for Altera. Click the button below — it is valid for 15 minutes and can only be used once.\n\nIf you did not request this, you can safely ignore this email."
    return {
      subject: "Your Altera login link",
      preheader: "Your one-time sign-in link",
      text: `${body}\n\nSign in to Altera: ${url}\n\nThis link expires in 15 minutes.\n\nAltera — a journal about life.`,
      html: `<p>Hello,</p><p>you requested a login link for Altera. Click the button below — it is valid for 15 minutes and can only be used once.</p><p><a href="${escapedUrl}">Sign in to Altera</a></p><p>This link expires in 15 minutes.</p><p>If you did not request this, you can safely ignore this email.</p><p>Altera — a journal about life.</p>`
    }
  }

  const body =
    "Здравствуйте,\n\nвы запросили ссылку входа в Altera. Перейдите по кнопке ниже — она действует 15 минут и подходит только для одного входа.\n\nЕсли вы не запрашивали ссылку — просто проигнорируйте это письмо."
  return {
    subject: "Ссылка входа в Altera",
    preheader: "Ваша одноразовая ссылка для входа",
    text: `${body}\n\nВойти в Altera: ${url}\n\nСсылка действует 15 минут.\n\nAltera — журнал о жизни.`,
    html: `<p>Здравствуйте,</p><p>вы запросили ссылку входа в Altera. Перейдите по кнопке ниже — она действует 15 минут и подходит только для одного входа.</p><p><a href="${escapedUrl}">Войти в Altera</a></p><p>Ссылка действует 15 минут.</p><p>Если вы не запрашивали ссылку — просто проигнорируйте это письмо.</p><p>Altera — журнал о жизни.</p>`
  }
}

export const MAGIC_LINK_TEMPLATE = "magic_link"

// [ДОПУЩЕНИЕ] Пометка вместо секрета в копии письма (docs/spec/40-admin/mail.md §3).
const secretPlaceholder: Record<Locale, string> = {
  ru: "[секрет не показывается]",
  en: "[secret not shown]"
}

export interface MagicLinkMail {
  message: MailMessage
  sanitizedBody: string
}

export const createMagicLinkMail = (locale: Locale, url: string): MagicLinkMail => ({
  message: createMagicLinkMessage(locale, url),
  sanitizedBody: createMagicLinkMessage(locale, secretPlaceholder[locale]).text
})
