import { randomInt } from "node:crypto"
import { addMinutes } from "date-fns"
import { createApiError } from "../errors/graphql-error"
import { equalHexHashes, hashEmailChangeCode } from "./token-hash"
import { isEmailAddress, maskEmail, normalizeEmail } from "./email-address"
import {
  createEmailChangeCodeMail,
  createEmailChangeNoticeMessage,
  EMAIL_CHANGE_CODE_TEMPLATE,
  EMAIL_CHANGE_NOTICE_TEMPLATE
} from "../mail/messages"
import type { EmailChangeRequest, Locale, PrismaClient, Role } from "../generated/prisma"
import type { MailService } from "../mail/service"
import type { RateLimiter } from "../rate-limits"

/**
 * Смена адреса по коду (журнал §25.8, `30-account/reader/email-change.md`): код уходит на новый
 * адрес, вводится в том же окне, адрес меняется сразу. Сессии здесь не трогаются намеренно —
 * ни одна ветка не вызывает отзыв: сохранность сессий и есть результат задачи.
 */

// Срок кода — общий параметр токенов входа (`email-change.md` §4), отдельного числа
// спецификация не задаёт.
const codeExpiryMinutes = (): number => parseInt(process.env.MAGIC_LINK_EXPIRY_MINUTES || "15")

/**
 * [ДОПУЩЕНИЕ] Число попыток кода (`email-change.md` §12). Своего числа задача вводить не вправе,
 * поэтому взят общий порог подтверждения одноразового входа — 10 попыток
 * (`50-access/rate-limits.md` §2 п. 3). По исчерпании запрос закрывается (§8).
 */
export const EMAIL_CHANGE_CODE_ATTEMPTS = 10

/** Шестизначный код: вводится вручную с телефона, поэтому короткий и только из цифр (§9). */
const CODE_DIGITS = 6

/**
 * Секрет хэша кода. Отдельное значение позволяет развести его с токенами доступа; без него
 * используется уже обязательный серверный секрет, чтобы развёртывание не требовало новой
 * переменной окружения.
 */
const codeSecret = (): string => {
  const secret = process.env.EMAIL_CHANGE_CODE_SECRET || process.env.JWT_ACCESS_SECRET
  if (!secret) throw new Error("EMAIL_CHANGE_CODE_SECRET or JWT_ACCESS_SECRET must be defined")
  return secret
}

export const generateEmailChangeCode = (): string => String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0")

export type EmailChangeStore = Pick<PrismaClient, "emailChangeRequest" | "user" | "auditLog" | "$transaction">

export interface EmailChangeActor {
  id: string
  email: string
  role: Role
  locale: Locale
}

export interface EmailChangeContext {
  store: EmailChangeStore
  actor: EmailChangeActor
  requestId: string
  mail: MailService
  rateLimiter: RateLimiter
  ip?: string | null
  now?: Date
}

export interface EmailChangePendingView {
  newEmailMasked: string
  expiresAt: Date
  attemptsLeft: number
}

export interface EmailChangeStateView {
  currentEmailMasked: string
  pending: EmailChangePendingView | null
}

export interface EmailChangeResultView {
  email: string
  changedAt: Date
}

const isExpired = (request: EmailChangeRequest, now: Date): boolean => request.expiresAt <= now

const toPendingView = (request: EmailChangeRequest): EmailChangePendingView => ({
  newEmailMasked: maskEmail(request.newEmail),
  expiresAt: request.expiresAt,
  attemptsLeft: Math.max(0, EMAIL_CHANGE_CODE_ATTEMPTS - request.attempts)
})

const toStateView = (email: string, request: EmailChangeRequest | null): EmailChangeStateView => ({
  currentEmailMasked: maskEmail(email),
  pending: request ? toPendingView(request) : null
})

/**
 * Открытый запрос показывается и после истечения срока: зона 4 должна сказать «код истёк» и
 * предложить отправить код ещё раз (§8), а не молча вернуться к пустой форме.
 */
export async function readEmailChangeState(context: EmailChangeContext): Promise<EmailChangeStateView> {
  const request = await context.store.emailChangeRequest.findUnique({ where: { userId: context.actor.id } })
  return toStateView(context.actor.email, request)
}

export async function requestEmailChange(context: EmailChangeContext, newEmail: string): Promise<EmailChangeStateView> {
  const { store, actor, requestId } = context
  const now = context.now ?? new Date()
  const address = normalizeEmail(newEmail)

  if (!isEmailAddress(address)) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "newEmail", rule: "email format" })
  }
  if (address === normalizeEmail(actor.email)) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "newEmail", rule: "different from current" })
  }

  const open = await store.emailChangeRequest.findUnique({ where: { userId: actor.id } })
  // Повторная отправка на тот же адрес — это «отправить код ещё раз» (§7): прежний код
  // становится недействительным. Другой адрес при открытом запросе — `CONFLICT` (flow #13 §4).
  if (open && !isExpired(open, now) && normalizeEmail(open.newEmail) !== address) {
    throw createApiError("CONFLICT", {
      requestId,
      entity: "emailChange",
      expected: "no open request",
      actual: "open request"
    })
  }

  // Лимит — последним, после проверки прав и валидации (`permission-checks.md` п. 3):
  // 1 запрос в сутки на аккаунт (`rate-limits.md` §2 п. 8).
  await context.rateLimiter.enforce("account.email_change.user", actor.id, { requestId, ip: context.ip })

  const code = generateEmailChangeCode()
  const expiryMinutes = codeExpiryMinutes()
  const payload = {
    newEmail: address,
    codeHash: hashEmailChangeCode(code, codeSecret()),
    expiresAt: addMinutes(now, expiryMinutes),
    attempts: 0
  }
  const saved = await store.emailChangeRequest.upsert({
    where: { userId: actor.id },
    update: payload,
    create: { userId: actor.id, ...payload }
  })

  // Занятость адреса другим аккаунтом сообщается только на шаге кода, чтобы запрос кода не
  // отвечал, существует ли такой аккаунт (§4, `[ДОПУЩЕНИЕ]`).
  const { message, sanitizedBody } = createEmailChangeCodeMail(actor.locale, code, expiryMinutes)
  await context.mail.send({
    template: EMAIL_CHANGE_CODE_TEMPLATE,
    to: address,
    content: { subject: message.subject, text: message.text, html: message.html },
    sanitizedBody,
    objectType: "user",
    objectId: actor.id,
    requestId
  })

  return toStateView(actor.email, saved)
}

export async function cancelEmailChange(context: EmailChangeContext): Promise<EmailChangeStateView> {
  await context.store.emailChangeRequest.deleteMany({ where: { userId: context.actor.id } })
  return toStateView(context.actor.email, null)
}

export async function confirmEmailChange(context: EmailChangeContext, code: string): Promise<EmailChangeResultView> {
  const { store, actor, requestId } = context
  const now = context.now ?? new Date()
  const request = await store.emailChangeRequest.findUnique({ where: { userId: actor.id } })

  // Неизвестный и истёкший запрос отвечают одинаково: по §8 это одна строка «код истёк».
  if (!request || isExpired(request, now)) {
    if (request) await store.emailChangeRequest.deleteMany({ where: { userId: actor.id } })
    throw createApiError("NOT_FOUND", { requestId, entity: "emailChange" })
  }

  if (!equalHexHashes(request.codeHash, hashEmailChangeCode(code.trim(), codeSecret()))) {
    const attempts = request.attempts + 1
    if (attempts >= EMAIL_CHANGE_CODE_ATTEMPTS) {
      await store.emailChangeRequest.deleteMany({ where: { userId: actor.id } })
    } else {
      await store.emailChangeRequest.update({ where: { userId: actor.id }, data: { attempts } })
    }
    throw createApiError("VALIDATION_ERROR", { requestId, field: "code", rule: "confirmation code" })
  }

  const taken = await store.user.findUnique({ where: { email: request.newEmail }, select: { id: true } })
  if (taken && taken.id !== actor.id) {
    // Запрос закрывается: продолжить можно только с другим адресом (§8).
    await store.emailChangeRequest.deleteMany({ where: { userId: actor.id } })
    throw createApiError("CONFLICT", {
      requestId,
      entity: "user",
      expected: "free address",
      actual: "address taken"
    })
  }

  const previousEmail = actor.email
  await store.$transaction(async (tx) => {
    await tx.user.update({ where: { id: actor.id }, data: { email: request.newEmail } })
    await tx.emailChangeRequest.deleteMany({ where: { userId: actor.id } })
    // Адреса хранит аудит, а не лог (§11): журнал читают только `admin` и `owner`.
    await tx.auditLog.create({
      data: {
        action: "user.email.change",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: actor.id,
        diff: { targetId: actor.id, via: "self", previousEmail, newEmail: request.newEmail },
        requestId
      }
    })
  })

  // Уведомление прежнему адресу (шаг 3 flow #13) не может отменить уже выполненную смену,
  // поэтому отказ почты только фиксируется службой писем и наружу не поднимается.
  const notice = createEmailChangeNoticeMessage(actor.locale)
  try {
    await context.mail.send({
      template: EMAIL_CHANGE_NOTICE_TEMPLATE,
      to: previousEmail,
      content: { subject: notice.subject, text: notice.text, html: notice.html },
      sanitizedBody: notice.text,
      objectType: "user",
      objectId: actor.id,
      requestId
    })
  } catch {
    // `mail.failed` уже записан службой писем: второй записи об этом же отказе не нужно.
  }

  return { email: maskEmail(request.newEmail), changedAt: now }
}
