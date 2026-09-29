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

export const EMAIL_CONFIRM_TEMPLATE = "email_confirm"
export const PASSWORD_RESET_TEMPLATE = "password_reset"
export const PASSWORD_ACCOUNT_EXISTS_TEMPLATE = "password_account_exists"

/**
 * [ДОПУЩЕНИЕ] Тексты писем ветки пароля (журнал §34 п. 7): состав и шаблоны писем отложены до
 * прохода почты (§25.13), поэтому письма повторяют тон письма входа и несут только ссылку и
 * срок её действия. Письмо подтверждения адреса уходит после регистрации с паролем: до перехода
 * по ссылке вход по паролю закрыт.
 */
export const createEmailConfirmMessage = (locale: Locale, url: string, expiryMinutes: number): MailMessage => {
  const escapedUrl = escapeHtml(url)

  if (locale === "en") {
    return {
      subject: "Confirm your Altera address",
      preheader: "One-time link to confirm your address",
      text: `Hello,\n\nyou created an Altera account with a password. Confirm the address to sign in.\n\nConfirm: ${url}\n\nThe link expires in ${expiryMinutes} minutes and works only once.\n\nIf you did not create the account, you can safely ignore this email — without confirmation it stays unusable.\n\nAltera — a journal about life.`,
      html: `<p>Hello,</p><p>you created an Altera account with a password. Confirm the address to sign in.</p><p><a href="${escapedUrl}">Confirm the address</a></p><p>The link expires in ${expiryMinutes} minutes and works only once.</p><p>If you did not create the account, you can safely ignore this email — without confirmation it stays unusable.</p><p>Altera — a journal about life.</p>`
    }
  }

  return {
    subject: "Подтвердите адрес в Altera",
    preheader: "Одноразовая ссылка для подтверждения адреса",
    text: `Здравствуйте,\n\nвы завели аккаунт Altera с паролем. Подтвердите адрес, чтобы войти.\n\nПодтвердить: ${url}\n\nСсылка действует ${expiryMinutes} минут и подходит только для одного подтверждения.\n\nЕсли аккаунт заводили не вы — просто проигнорируйте это письмо: без подтверждения им нельзя пользоваться.\n\nAltera — журнал о жизни.`,
    html: `<p>Здравствуйте,</p><p>вы завели аккаунт Altera с паролем. Подтвердите адрес, чтобы войти.</p><p><a href="${escapedUrl}">Подтвердить адрес</a></p><p>Ссылка действует ${expiryMinutes} минут и подходит только для одного подтверждения.</p><p>Если аккаунт заводили не вы — просто проигнорируйте это письмо: без подтверждения им нельзя пользоваться.</p><p>Altera — журнал о жизни.</p>`
  }
}

/** [ДОПУЩЕНИЕ] Письмо сброса пароля (журнал §34 п. 7): ссылка одноразовая, как ссылка входа. */
export const createPasswordResetMessage = (locale: Locale, url: string, expiryMinutes: number): MailMessage => {
  const escapedUrl = escapeHtml(url)

  if (locale === "en") {
    return {
      subject: "Reset your Altera password",
      preheader: "One-time link to set a new password",
      text: `Hello,\n\nyou asked to reset the password of your Altera account. Set a new one using the link below.\n\nSet a new password: ${url}\n\nThe link expires in ${expiryMinutes} minutes and works only once. The current password keeps working until you set a new one.\n\nIf you did not ask for this, you can safely ignore this email.\n\nAltera — a journal about life.`,
      html: `<p>Hello,</p><p>you asked to reset the password of your Altera account. Set a new one using the link below.</p><p><a href="${escapedUrl}">Set a new password</a></p><p>The link expires in ${expiryMinutes} minutes and works only once. The current password keeps working until you set a new one.</p><p>If you did not ask for this, you can safely ignore this email.</p><p>Altera — a journal about life.</p>`
    }
  }

  return {
    subject: "Сброс пароля в Altera",
    preheader: "Одноразовая ссылка для нового пароля",
    text: `Здравствуйте,\n\nвы попросили сбросить пароль аккаунта Altera. Задайте новый по ссылке ниже.\n\nЗадать новый пароль: ${url}\n\nСсылка действует ${expiryMinutes} минут и подходит только для одной попытки. Прежний пароль работает, пока новый не задан.\n\nЕсли вы не просили сброс — просто проигнорируйте это письмо.\n\nAltera — журнал о жизни.`,
    html: `<p>Здравствуйте,</p><p>вы попросили сбросить пароль аккаунта Altera. Задайте новый по ссылке ниже.</p><p><a href="${escapedUrl}">Задать новый пароль</a></p><p>Ссылка действует ${expiryMinutes} минут и подходит только для одной попытки. Прежний пароль работает, пока новый не задан.</p><p>Если вы не просили сброс — просто проигнорируйте это письмо.</p><p>Altera — журнал о жизни.</p>`
  }
}

/**
 * [ДОПУЩЕНИЕ] Регистрация на занятый адрес отвечает ровно тем же, что и на свободный
 * (`20-public/login.md` §4: ответ не раскрывает существование аккаунта), поэтому сказать «такой
 * аккаунт уже есть» можно только письмом — его прочитает лишь владелец ящика. Чужой аккаунт при
 * этом не меняется: ни пароль, ни адрес.
 */
export const createAccountExistsMessage = (locale: Locale, url: string): MailMessage => {
  const escapedUrl = escapeHtml(url)

  if (locale === "en") {
    return {
      subject: "You already have an Altera account",
      preheader: "Someone tried to register this address again",
      text: `Hello,\n\nsomebody tried to create an Altera account with this address, and it already has one. Nothing has changed: the password and the address stayed as they were.\n\nSign in: ${url}\n\nIf you have forgotten the password, use “Forgot password” on the sign-in page — or sign in with a one-time link instead.\n\nAltera — a journal about life.`,
      html: `<p>Hello,</p><p>somebody tried to create an Altera account with this address, and it already has one. Nothing has changed: the password and the address stayed as they were.</p><p><a href="${escapedUrl}">Sign in</a></p><p>If you have forgotten the password, use “Forgot password” on the sign-in page — or sign in with a one-time link instead.</p><p>Altera — a journal about life.</p>`
    }
  }

  return {
    subject: "У вас уже есть аккаунт Altera",
    preheader: "Кто-то пробовал зарегистрировать этот адрес снова",
    text: `Здравствуйте,\n\nкто-то попробовал завести аккаунт Altera на этот адрес, а он уже есть. Ничего не изменилось: пароль и адрес остались прежними.\n\nВойти: ${url}\n\nЕсли пароль забыт — воспользуйтесь ссылкой «Забыли пароль?» на странице входа или войдите по одноразовой ссылке.\n\nAltera — журнал о жизни.`,
    html: `<p>Здравствуйте,</p><p>кто-то попробовал завести аккаунт Altera на этот адрес, а он уже есть. Ничего не изменилось: пароль и адрес остались прежними.</p><p><a href="${escapedUrl}">Войти</a></p><p>Если пароль забыт — воспользуйтесь ссылкой «Забыли пароль?» на странице входа или войдите по одноразовой ссылке.</p><p>Altera — журнал о жизни.</p>`
  }
}

export interface PasswordBranchMail {
  message: MailMessage
  sanitizedBody: string
}

export const createEmailConfirmMail = (locale: Locale, url: string, expiryMinutes: number): PasswordBranchMail => ({
  message: createEmailConfirmMessage(locale, url, expiryMinutes),
  sanitizedBody: createEmailConfirmMessage(locale, secretPlaceholder[locale], expiryMinutes).text
})

export const createPasswordResetMail = (locale: Locale, url: string, expiryMinutes: number): PasswordBranchMail => ({
  message: createPasswordResetMessage(locale, url, expiryMinutes),
  sanitizedBody: createPasswordResetMessage(locale, secretPlaceholder[locale], expiryMinutes).text
})

/** Ссылка на страницу входа секретом не является, поэтому копия истории повторяет письмо. */
export const createAccountExistsMail = (locale: Locale, url: string): PasswordBranchMail => ({
  message: createAccountExistsMessage(locale, url),
  sanitizedBody: createAccountExistsMessage(locale, url).text
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

export const ACCOUNT_ARCHIVE_CONFIRM_TEMPLATE = "account_archive_confirm"

/**
 * Письмо подтверждения «удаления аккаунта» — шаг 2 flow #12 (`10-flows/delete-account.md` §6).
 * Владелец включил его в первый запуск (журнал §35 п. 1); остальные письма сценария (после
 * архива и после восстановления) остаются `[ДОПУЩЕНИЕ]` и ждут прохода почты (§25.13).
 * Текст называет последствия словами: доступ закроется сразу, данные сохранятся, вернуться
 * можно самому после входа (журнал §5.1–2).
 */
export const createAccountArchiveConfirmMessage = (locale: Locale, url: string, expiryMinutes: number): MailMessage => {
  const escapedUrl = escapeHtml(url)

  if (locale === "en") {
    return {
      subject: "Confirm deleting your Altera account",
      preheader: "One-time link for archiving your account",
      text: `Hello,\n\nyou asked to delete your Altera account. Access closes immediately, your articles move to the archive and your data is kept: you can bring the account back yourself after signing in again.\n\nConfirm: ${url}\n\nThe link expires in ${expiryMinutes} minutes and works only once.\n\nIf you did not request this, you can safely ignore this email.\n\nAltera — a journal about life.`,
      html: `<p>Hello,</p><p>you asked to delete your Altera account. Access closes immediately, your articles move to the archive and your data is kept: you can bring the account back yourself after signing in again.</p><p><a href="${escapedUrl}">Confirm deleting the account</a></p><p>The link expires in ${expiryMinutes} minutes and works only once.</p><p>If you did not request this, you can safely ignore this email.</p><p>Altera — a journal about life.</p>`
    }
  }

  return {
    subject: "Подтвердите удаление аккаунта Altera",
    preheader: "Одноразовая ссылка для архивирования аккаунта",
    text: `Здравствуйте,\n\nвы попросили удалить аккаунт Altera. Доступ закроется сразу, материалы уйдут в архив, а данные сохранятся: вернуться можно самому — просто войдите снова.\n\nПодтвердить: ${url}\n\nСсылка действует ${expiryMinutes} минут и подходит только для одного подтверждения.\n\nЕсли вы не запрашивали удаление — просто проигнорируйте это письмо.\n\nAltera — журнал о жизни.`,
    html: `<p>Здравствуйте,</p><p>вы попросили удалить аккаунт Altera. Доступ закроется сразу, материалы уйдут в архив, а данные сохранятся: вернуться можно самому — просто войдите снова.</p><p><a href="${escapedUrl}">Подтвердить удаление аккаунта</a></p><p>Ссылка действует ${expiryMinutes} минут и подходит только для одного подтверждения.</p><p>Если вы не запрашивали удаление — просто проигнорируйте это письмо.</p><p>Altera — журнал о жизни.</p>`
  }
}

export interface AccountArchiveConfirmMail {
  message: MailMessage
  sanitizedBody: string
}

export const createAccountArchiveConfirmMail = (
  locale: Locale,
  url: string,
  expiryMinutes: number
): AccountArchiveConfirmMail => ({
  message: createAccountArchiveConfirmMessage(locale, url, expiryMinutes),
  sanitizedBody: createAccountArchiveConfirmMessage(locale, secretPlaceholder[locale], expiryMinutes).text
})

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

export const ARTICLE_PUBLISHED_TEMPLATE = "article_published"
export const ARTICLE_AI_REJECTED_TEMPLATE = "article_ai_rejected"
export const ARTICLE_REWORK_REQUESTED_TEMPLATE = "article_rework_requested"
export const ARTICLE_PUBLISHED_MANUAL_TEMPLATE = "article_published_manual"
export const ARTICLE_REJECTED_FINAL_TEMPLATE = "article_rejected_final"
export const ARTICLE_UNPUBLISHED_TEMPLATE = "article_unpublished"

/**
 * [ДОПУЩЕНИЕ] Письма решений по статье (T-051, журнал #14, #43, §20.10–11): состав и частота
 * отложены до прохода почты (§25.13). Здесь — минимальный текст решения со ссылкой на следующий
 * шаг (`10-flows/write-and-publish.md` §6, `10-flows/moderation.md` §6); причина или
 * рекомендации редактора идут как есть, без изменения смысла.
 */
export const createArticlePublishedMessage = (locale: Locale, title: string, url: string): MailMessage => {
  const escapedTitle = escapeHtml(title)
  const escapedUrl = escapeHtml(url)

  if (locale === "en") {
    return {
      subject: "Your article is published",
      preheader: "Altera published your article automatically",
      text: `Hello,\n\nyour article “${title}” passed the check and is published.\n\nOpen the article: ${url}\n\nAltera — a journal about life.`,
      html: `<p>Hello,</p><p>your article “${escapedTitle}” passed the check and is published.</p><p><a href="${escapedUrl}">Open the article</a></p><p>Altera — a journal about life.</p>`
    }
  }

  return {
    subject: "Материал опубликован",
    preheader: "Altera опубликовала материал автоматически",
    text: `Здравствуйте,\n\nматериал «${title}» прошёл проверку и опубликован.\n\nОткрыть материал: ${url}\n\nAltera — журнал о жизни.`,
    html: `<p>Здравствуйте,</p><p>материал «${escapedTitle}» прошёл проверку и опубликован.</p><p><a href="${escapedUrl}">Открыть материал</a></p><p>Altera — журнал о жизни.</p>`
  }
}

export const createArticleAiRejectedMessage = (locale: Locale, title: string, url: string): MailMessage => {
  const escapedTitle = escapeHtml(title)
  const escapedUrl = escapeHtml(url)

  if (locale === "en") {
    return {
      subject: "Your article did not pass the check",
      preheader: "The automatic check did not accept your article",
      text: `Hello,\n\nyour article “${title}” did not pass the automatic check. The reasons are in your account.\n\nOpen the reasons: ${url}\n\nAltera — a journal about life.`,
      html: `<p>Hello,</p><p>your article “${escapedTitle}” did not pass the automatic check. The reasons are in your account.</p><p><a href="${escapedUrl}">Open the reasons</a></p><p>Altera — a journal about life.</p>`
    }
  }

  return {
    subject: "Материал не прошёл проверку",
    preheader: "Автоматическая проверка не пропустила материал",
    text: `Здравствуйте,\n\nматериал «${title}» не прошёл автоматическую проверку. Причины — в вашем кабинете.\n\nПосмотреть причины: ${url}\n\nAltera — журнал о жизни.`,
    html: `<p>Здравствуйте,</p><p>материал «${escapedTitle}» не прошёл автоматическую проверку. Причины — в вашем кабинете.</p><p><a href="${escapedUrl}">Посмотреть причины</a></p><p>Altera — журнал о жизни.</p>`
  }
}

export const createArticleReworkRequestedMessage = (
  locale: Locale,
  title: string,
  recommendations: string,
  url: string
): MailMessage => {
  const escapedTitle = escapeHtml(title)
  const escapedRecommendations = escapeHtml(recommendations)
  const escapedUrl = escapeHtml(url)

  if (locale === "en") {
    return {
      subject: "Your article needs rework",
      preheader: "The reviewer sent your article back with recommendations",
      text: `Hello,\n\nthe reviewer sent your article “${title}” back for rework:\n\n${recommendations}\n\nOpen the editor: ${url}\n\nAltera — a journal about life.`,
      html: `<p>Hello,</p><p>the reviewer sent your article “${escapedTitle}” back for rework:</p><p>${escapedRecommendations.replace(/\n/g, "<br>")}</p><p><a href="${escapedUrl}">Open the editor</a></p><p>Altera — a journal about life.</p>`
    }
  }

  return {
    subject: "Материал нужно доработать",
    preheader: "Ревьюер вернул материал с рекомендациями",
    text: `Здравствуйте,\n\nревьюер вернул материал «${title}» на доработку с рекомендациями:\n\n${recommendations}\n\nОткрыть редактор: ${url}\n\nAltera — журнал о жизни.`,
    html: `<p>Здравствуйте,</p><p>ревьюер вернул материал «${escapedTitle}» на доработку с рекомендациями:</p><p>${escapedRecommendations.replace(/\n/g, "<br>")}</p><p><a href="${escapedUrl}">Открыть редактор</a></p><p>Altera — журнал о жизни.</p>`
  }
}

export const createArticlePublishedManualMessage = (locale: Locale, title: string, url: string): MailMessage => {
  const escapedTitle = escapeHtml(title)
  const escapedUrl = escapeHtml(url)

  if (locale === "en") {
    return {
      subject: "The editors published your article",
      preheader: "Your article is published",
      text: `Hello,\n\nthe editors reviewed and published your article “${title}”.\n\nOpen the article: ${url}\n\nAltera — a journal about life.`,
      html: `<p>Hello,</p><p>the editors reviewed and published your article “${escapedTitle}”.</p><p><a href="${escapedUrl}">Open the article</a></p><p>Altera — a journal about life.</p>`
    }
  }

  return {
    subject: "Материал опубликован редакцией",
    preheader: "Ваш материал опубликован",
    text: `Здравствуйте,\n\nредакция рассмотрела и опубликовала материал «${title}».\n\nОткрыть материал: ${url}\n\nAltera — журнал о жизни.`,
    html: `<p>Здравствуйте,</p><p>редакция рассмотрела и опубликовала материал «${escapedTitle}».</p><p><a href="${escapedUrl}">Открыть материал</a></p><p>Altera — журнал о жизни.</p>`
  }
}

export const createArticleRejectedFinalMessage = (
  locale: Locale,
  title: string,
  reason: string | null,
  url: string
): MailMessage => {
  const escapedTitle = escapeHtml(title)
  const escapedUrl = escapeHtml(url)
  const escapedReason = reason ? escapeHtml(reason) : null

  if (locale === "en") {
    const reasonLine = escapedReason ? `<p>${escapedReason.replace(/\n/g, "<br>")}</p>` : ""
    return {
      subject: "The editors declined your article",
      preheader: "Your article was declined",
      text: `Hello,\n\nthe editors declined your article “${title}” for good.${reason ? `\n\n${reason}` : ""}\n\nOpen the decision: ${url}\n\nAltera — a journal about life.`,
      html: `<p>Hello,</p><p>the editors declined your article “${escapedTitle}” for good.</p>${reasonLine}<p><a href="${escapedUrl}">Open the decision</a></p><p>Altera — a journal about life.</p>`
    }
  }

  const reasonLine = escapedReason ? `<p>${escapedReason.replace(/\n/g, "<br>")}</p>` : ""
  return {
    subject: "Материал отклонён редакцией",
    preheader: "Ваш материал отклонён",
    text: `Здравствуйте,\n\nредакция окончательно отклонила материал «${title}».${reason ? `\n\n${reason}` : ""}\n\nПосмотреть решение: ${url}\n\nAltera — журнал о жизни.`,
    html: `<p>Здравствуйте,</p><p>редакция окончательно отклонила материал «${escapedTitle}».</p>${reasonLine}<p><a href="${escapedUrl}">Посмотреть решение</a></p><p>Altera — журнал о жизни.</p>`
  }
}

export const createArticleUnpublishedMessage = (
  locale: Locale,
  title: string,
  reason: string,
  url: string
): MailMessage => {
  const escapedTitle = escapeHtml(title)
  const escapedReason = escapeHtml(reason)
  const escapedUrl = escapeHtml(url)

  if (locale === "en") {
    return {
      subject: "Your article was unpublished",
      preheader: "The editors removed your article from publication",
      text: `Hello,\n\nthe editors removed your article “${title}” from publication:\n\n${reason}\n\nOpen the editor: ${url}\n\nAltera — a journal about life.`,
      html: `<p>Hello,</p><p>the editors removed your article “${escapedTitle}” from publication:</p><p>${escapedReason.replace(/\n/g, "<br>")}</p><p><a href="${escapedUrl}">Open the editor</a></p><p>Altera — a journal about life.</p>`
    }
  }

  return {
    subject: "Материал снят с публикации",
    preheader: "Редакция сняла материал с публикации",
    text: `Здравствуйте,\n\nредакция сняла материал «${title}» с публикации:\n\n${reason}\n\nОткрыть редактор: ${url}\n\nAltera — журнал о жизни.`,
    html: `<p>Здравствуйте,</p><p>редакция сняла материал «${escapedTitle}» с публикации:</p><p>${escapedReason.replace(/\n/g, "<br>")}</p><p><a href="${escapedUrl}">Открыть редактор</a></p><p>Altera — журнал о жизни.</p>`
  }
}

export interface ArticleEditTokenMail {
  message: MailMessage
  sanitizedBody: string
}

/** Ссылка несёт токен входа (`routes.md` #68) — копия истории заменяет её плейсхолдером. */
export const createArticleReworkRequestedMail = (
  locale: Locale,
  title: string,
  recommendations: string,
  url: string
): ArticleEditTokenMail => ({
  message: createArticleReworkRequestedMessage(locale, title, recommendations, url),
  sanitizedBody: createArticleReworkRequestedMessage(locale, title, recommendations, secretPlaceholder[locale]).text
})

export const createArticleUnpublishedMail = (
  locale: Locale,
  title: string,
  reason: string,
  url: string
): ArticleEditTokenMail => ({
  message: createArticleUnpublishedMessage(locale, title, reason, url),
  sanitizedBody: createArticleUnpublishedMessage(locale, title, reason, secretPlaceholder[locale]).text
})
