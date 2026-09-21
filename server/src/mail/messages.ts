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

export const EMAIL_CHANGE_CODE_TEMPLATE = "email_change_code"
export const EMAIL_CHANGE_NOTICE_TEMPLATE = "email_change_notice"

/**
 * [ДОПУЩЕНИЕ] Текст письма с кодом: состав писем отложен до прохода почты (журнал §25.13,
 * `10-flows/email-change-and-recovery.md` §6). Здесь письмо повторяет тон письма входа и
 * несёт только код и срок его действия — ссылки в нём нет (`email-change.md` §3).
 */
export const createEmailChangeCodeMessage = (locale: Locale, code: string, expiryMinutes: number): MailMessage => {
  const escapedCode = escapeHtml(code)

  if (locale === "en") {
    return {
      subject: "Your Altera e-mail change code",
      preheader: "One-time code for changing your address",
      text: `Hello,\n\nyou asked to change the e-mail address of your Altera account to this one. Enter the code in the window where you started the change.\n\nCode: ${code}\n\nThe code expires in ${expiryMinutes} minutes and works only once.\n\nIf you did not request this, you can safely ignore this email.\n\nAltera — a journal about life.`,
      html: `<p>Hello,</p><p>you asked to change the e-mail address of your Altera account to this one. Enter the code in the window where you started the change.</p><p><strong>${escapedCode}</strong></p><p>The code expires in ${expiryMinutes} minutes and works only once.</p><p>If you did not request this, you can safely ignore this email.</p><p>Altera — a journal about life.</p>`
    }
  }

  return {
    subject: "Код смены почты в Altera",
    preheader: "Одноразовый код для смены адреса",
    text: `Здравствуйте,\n\nвы попросили сменить адрес аккаунта Altera на этот. Введите код в том же окне, где начали смену.\n\nКод: ${code}\n\nКод действует ${expiryMinutes} минут и подходит только для одной попытки смены.\n\nЕсли вы не запрашивали смену — просто проигнорируйте это письмо.\n\nAltera — журнал о жизни.`,
    html: `<p>Здравствуйте,</p><p>вы попросили сменить адрес аккаунта Altera на этот. Введите код в том же окне, где начали смену.</p><p><strong>${escapedCode}</strong></p><p>Код действует ${expiryMinutes} минут и подходит только для одной попытки смены.</p><p>Если вы не запрашивали смену — просто проигнорируйте это письмо.</p><p>Altera — журнал о жизни.</p>`
  }
}

export interface EmailChangeCodeMail {
  message: MailMessage
  sanitizedBody: string
}

export const createEmailChangeCodeMail = (
  locale: Locale,
  code: string,
  expiryMinutes: number
): EmailChangeCodeMail => ({
  message: createEmailChangeCodeMessage(locale, code, expiryMinutes),
  sanitizedBody: createEmailChangeCodeMessage(locale, secretPlaceholder[locale], expiryMinutes).text
})

/**
 * [ДОПУЩЕНИЕ] Уведомление на прежний адрес (шаг 3 flow #13): состав отложен до прохода почты
 * (§25.13). Нового адреса письмо не называет — прежний ящик мог быть потерян, и адрес не
 * должен раскрываться тому, кто его читает.
 */
export const createEmailChangeNoticeMessage = (locale: Locale): MailMessage => {
  if (locale === "en") {
    return {
      subject: "The e-mail address of your Altera account has changed",
      preheader: "Your sign-in address was changed",
      text: "Hello,\n\nthe e-mail address of your Altera account has been changed. Sign-in links now go to the new address.\n\nIf it was not you, write to the editors from the contact page and mention that you have lost access to your mailbox.\n\nAltera — a journal about life.",
      html: "<p>Hello,</p><p>the e-mail address of your Altera account has been changed. Sign-in links now go to the new address.</p><p>If it was not you, write to the editors from the contact page and mention that you have lost access to your mailbox.</p><p>Altera — a journal about life.</p>"
    }
  }

  return {
    subject: "Адрес аккаунта Altera изменён",
    preheader: "Адрес входа в аккаунт изменён",
    text: "Здравствуйте,\n\nадрес электронной почты вашего аккаунта Altera изменён. Ссылки входа теперь приходят на новый адрес.\n\nЕсли это были не вы — напишите в редакцию со страницы контактов и укажите, что потеряли доступ к почте.\n\nAltera — журнал о жизни.",
    html: "<p>Здравствуйте,</p><p>адрес электронной почты вашего аккаунта Altera изменён. Ссылки входа теперь приходят на новый адрес.</p><p>Если это были не вы — напишите в редакцию со страницы контактов и укажите, что потеряли доступ к почте.</p><p>Altera — журнал о жизни.</p>"
  }
}

export const SUPPORT_REQUEST_STAFF_TEMPLATE = "support_request_staff"

export interface SupportRequestNotice {
  ticketNo: number
  topic: string
  email: string | null
  message: string | null
  path: string | null
  requestId: string | null
}

const noticeLines = (locale: Locale, notice: SupportRequestNotice, hidePersonal: boolean): string[] => {
  const en = locale === "en"
  const hidden = en ? "[in the request record]" : "[в записи обращения]"
  const none = "—"
  return [
    `${en ? "Topic" : "Тема"}: ${notice.topic}`,
    `${en ? "Reply to" : "Ответить на"}: ${hidePersonal && notice.email ? hidden : (notice.email ?? none)}`,
    `${en ? "Page" : "Страница"}: ${notice.path ?? none}`,
    `requestId: ${notice.requestId ?? none}`,
    "",
    hidePersonal && notice.message ? hidden : (notice.message ?? none)
  ]
}

/**
 * [ДОПУЩЕНИЕ] Уведомление сотрудникам о новом обращении (`20-public/contact.md` §4): состав писем
 * отложен до прохода почты (журнал §25.13). Экрана очереди в админке ещё нет (Q-08), поэтому
 * письмо несёт адрес ответа и текст — иначе ответить было бы не из чего. Копия для истории писем
 * их не повторяет: ПДн отправителя остаются в одной записи обращения.
 */
export const createSupportRequestNoticeMail = (
  locale: Locale,
  notice: SupportRequestNotice
): { message: MailMessage; sanitizedBody: string } => {
  const en = locale === "en"
  const intro = en
    ? `A new request No. ${notice.ticketNo} has arrived from the contact form. Reply by e-mail to the address below.`
    : `Поступило обращение №${notice.ticketNo} из формы «Письмо в редакцию». Ответ — письмом на указанный адрес.`
  const lines = noticeLines(locale, notice, false)
  return {
    message: {
      subject: en ? `Altera: request No. ${notice.ticketNo}` : `Altera: обращение №${notice.ticketNo}`,
      preheader: en ? "New support request" : "Новое обращение в поддержку",
      text: `${intro}\n\n${lines.join("\n")}`,
      html: `<p>${escapeHtml(intro)}</p>${lines.map((line) => (line ? `<p>${escapeHtml(line).replace(/\n/g, "<br>")}</p>` : "")).join("")}`
    },
    sanitizedBody: `${intro}\n\n${noticeLines(locale, notice, true).join("\n")}`
  }
}
