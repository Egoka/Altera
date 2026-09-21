import { createApiError } from "../errors/graphql-error"
import { isEmailAddress, normalizeEmail } from "../auth/email-address"
import { createSupportRequestNoticeMail, SUPPORT_REQUEST_STAFF_TEMPLATE } from "../mail/messages"
import type { Locale, PrismaClient, Role, SupportTopic } from "../generated/prisma"
import type { AppLogger } from "../observability/logger"
import type { MailService } from "../mail/service"
import type { RateLimiter } from "../rate-limits"

/**
 * Обращения в поддержку и редакцию (`20-public/contact.md`, матрица #117): письмо с `/contact` и
 * «битая ссылка» со страницы 404 (журнал §20.15, `not-found.md` §4). Одна мутация, один лимит
 * (`rate-limits.md` §2 п. 4): корзина по адресу — middleware до резолвера, по аккаунту — здесь,
 * после валидации (`permission-checks.md` п. 3).
 */

export const SUPPORT_TOPICS: readonly SupportTopic[] = [
  "general",
  "broken_link",
  "refund",
  "copyright",
  "restore",
  "other"
]

/** [ДОПУЩЕНИЕ] Длина текста письма — 20–4000 знаков (`contact.md` §4). */
export const SUPPORT_MESSAGE_MIN = 20
export const SUPPORT_MESSAGE_MAX = 4000

/** Потолки служебных полей: путь и `requestId` приходят из адреса и не должны раздувать запись. */
const PATH_MAX = 1000
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

/**
 * Шаблоны маршрутов форм, из которых приходит обращение, — поле `route` события #80. Список
 * закрытый: в лог не должен попасть произвольный адрес с персональными данными в пути.
 */
export const SUPPORT_ROUTES = ["/contact", "/404"] as const

export type SupportRequestStore = Pick<PrismaClient, "supportRequest" | "user">

export interface SupportRequestActor {
  id: string
  email: string
  role: Role
  locale: Locale
  archivedAt: Date | null
}

export interface SupportRequestContext {
  store: SupportRequestStore
  /** Сессия аккаунта; архивированная запись пишет как гость (`contact.md` §8). */
  actor: SupportRequestActor | null
  requestId: string
  mail: MailService
  logger: AppLogger
  rateLimiter: RateLimiter
  ip?: string | null
}

export interface SupportRequestInput {
  topic: SupportTopic
  email?: string | null
  message?: string | null
  path?: string | null
  requestId?: string | null
  route?: string | null
  locale?: Locale | null
  /** Согласие гостя с политикой ПД (`contact.md` §5 зона 3 `[ДОПУЩЕНИЕ]`). */
  acceptPrivacy?: boolean | null
}

export interface SupportRequestResult {
  ok: true
  ticketNo: number
}

const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** Путь без query и фрагмента: чужая ссылка может нести в параметрах персональные данные. */
export const supportPath = (value: string | null | undefined): string | null => {
  const path = blankToNull(value)?.split(/[?#]/)[0]
  return path ? path : null
}

const invalid = (requestId: string, field: string, rule: string) =>
  createApiError("VALIDATION_ERROR", { requestId, field, rule })

export async function createSupportRequest(
  context: SupportRequestContext,
  input: SupportRequestInput
): Promise<SupportRequestResult> {
  const { requestId } = context
  // Архивированный аккаунт видит форму как гость и указывает адрес сам (`contact.md` §8).
  const account = context.actor && !context.actor.archivedAt ? context.actor : null

  if (!SUPPORT_TOPICS.includes(input.topic)) throw invalid(requestId, "topic", "known topic")
  const brokenLink = input.topic === "broken_link"

  // Комментарий к битой ссылке необязателен (`not-found.md` §4); письмо в редакцию — со смыслом.
  const message = blankToNull(input.message)
  if (message && message.length > SUPPORT_MESSAGE_MAX) {
    throw invalid(requestId, "message", `at most ${SUPPORT_MESSAGE_MAX} characters`)
  }
  if (!brokenLink && (!message || message.length < SUPPORT_MESSAGE_MIN)) {
    throw invalid(requestId, "message", `at least ${SUPPORT_MESSAGE_MIN} characters`)
  }

  // Адрес аккаунта берётся из сессии, переданный игнорируется (§4). Гостю адрес нужен для ответа;
  // анонимная кнопка 404 ответа не ждёт и адреса не просит.
  let email = account ? account.email : blankToNull(input.email)
  if (!account) {
    if (email) {
      email = normalizeEmail(email)
      if (!isEmailAddress(email)) throw invalid(requestId, "email", "email format")
    } else if (!brokenLink) {
      throw invalid(requestId, "email", "required")
    }
    // Согласие нужно, только когда гость оставляет адрес — других ПДн обращение не несёт.
    if (email && input.acceptPrivacy !== true) throw invalid(requestId, "acceptPrivacy", "required")
  }

  const path = supportPath(input.path)
  if (path && (!path.startsWith("/") || path.length > PATH_MAX)) throw invalid(requestId, "path", "site path")
  const relatedRequestId = blankToNull(input.requestId)
  if (relatedRequestId && !REQUEST_ID_PATTERN.test(relatedRequestId)) {
    throw invalid(requestId, "requestId", "request id format")
  }
  const route = SUPPORT_ROUTES.find((value) => value === input.route) ?? null

  // Лимит по аккаунту — последним (`permission-checks.md` п. 3): 10 в сутки (`rate-limits.md` §2 п. 4).
  if (account) await context.rateLimiter.enforce("contact.user", account.id, { requestId, ip: context.ip })

  const saved = await context.store.supportRequest.create({
    data: {
      topic: input.topic,
      email,
      message,
      path,
      requestId: relatedRequestId,
      userId: account?.id ?? null,
      locale: account?.locale ?? input.locale ?? "ru",
      createdByRequestId: requestId
    },
    select: { id: true, ticketNo: true }
  })

  // Событие #80: только тема, шаблон маршрута и `requestId` запроса — без ПДн отправителя.
  context.logger.log({
    level: "info",
    event: "support.request.created",
    requestId,
    message: "Support request created",
    data: { topic: input.topic, route }
  })

  await notifyStaff(context, saved, { topic: input.topic, email, message, path, requestId: relatedRequestId })

  return { ok: true, ticketNo: saved.ticketNo }
}

/**
 * Уведомление сотрудникам очереди (`admin`/`owner`, матрица #117). Обращение к этому моменту уже
 * сохранено, поэтому отказ почты его не отменяет и наружу не поднимается: повторная отправка
 * формы создала бы дубль. Отказ фиксирует служба писем (`mail.failed`), а письмо остаётся в
 * истории `/admin/mail` со статусом `failed`.
 */
async function notifyStaff(
  context: SupportRequestContext,
  saved: { id: string; ticketNo: number },
  notice: {
    topic: SupportTopic
    email: string | null
    message: string | null
    path: string | null
    requestId: string | null
  }
): Promise<void> {
  const staff = await context.store.user.findMany({
    where: { role: { in: ["admin", "owner"] }, archivedAt: null, isServiceAccount: false },
    select: { email: true, locale: true }
  })

  for (const recipient of staff) {
    const { message, sanitizedBody } = createSupportRequestNoticeMail(recipient.locale, {
      ticketNo: saved.ticketNo,
      ...notice
    })
    try {
      await context.mail.send({
        template: SUPPORT_REQUEST_STAFF_TEMPLATE,
        to: recipient.email,
        content: { subject: message.subject, text: message.text, html: message.html },
        sanitizedBody,
        objectType: "supportRequest",
        objectId: saved.id,
        requestId: context.requestId
      })
    } catch {
      // `mail.failed` уже записан службой писем; остальные сотрудники получают своё письмо.
    }
  }
}
