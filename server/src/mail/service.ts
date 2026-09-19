import type { PrismaClient } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import type { AppLogger } from "../observability/logger"
import type { MailTransport } from "./transport"

export type MailStore = Pick<PrismaClient, "mailMessage">

export interface MailContent {
  subject: string
  text: string
  html: string
}

export interface SendMailInput {
  template: string
  to: string
  /** Полное письмо уходит только в транспорт. */
  content: MailContent
  /** Копия для истории без ссылок входа, кодов и других секретов (журнал §27.6). */
  sanitizedBody: string
  objectType?: string
  objectId?: string
  requestId: string
}

export interface SentMail {
  mailId: string
  messageId: string | null
}

export interface MailService {
  send(input: SendMailInput): Promise<SentMail>
}

interface MailServiceOptions {
  store: MailStore
  transport: MailTransport
  logger: AppLogger
  from: string
}

const errorClassPattern = /^[A-Z][A-Z0-9_]{1,63}$/

/** Класс ошибки без сообщения: сообщение транспорта может содержать адрес или ответ сервера. */
function errorClassOf(error: unknown): string {
  const code = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined
  if (typeof code === "string" && errorClassPattern.test(code)) return code
  return error instanceof Error ? error.constructor.name : "UnknownError"
}

export function createMailService(options: MailServiceOptions): MailService {
  const { store, transport, logger, from } = options

  return {
    async send(input) {
      const { template, requestId } = input
      const mail = await store.mailMessage.create({
        data: {
          template,
          recipientEmail: input.to,
          subject: input.content.subject,
          sanitizedBody: input.sanitizedBody,
          provider: transport.name,
          objectType: input.objectType,
          objectId: input.objectId,
          deliveryEvents: { create: { status: "queued" } }
        },
        select: { id: true }
      })
      logger.log({
        level: "info",
        event: "mail.queued",
        requestId,
        message: "Mail queued",
        data: { mailId: mail.id, template, status: "queued", provider: transport.name }
      })

      let messageId: string | null
      try {
        const { subject, text, html } = input.content
        ;({ messageId } = await transport.send({ from, to: input.to, subject, text, html }))
      } catch (error: unknown) {
        const errorClass = errorClassOf(error)
        await store.mailMessage.update({
          where: { id: mail.id },
          data: {
            status: "failed",
            deliveryErrorClass: errorClass,
            deliveryEvents: { create: { status: "failed", errorClass } }
          },
          select: { id: true }
        })
        logger.log({
          level: "error",
          event: "mail.failed",
          requestId,
          message: "Mail delivery failed",
          data: { mailId: mail.id, template, status: "failed", provider: transport.name, errorClass }
        })
        throw createApiError("PROVIDER_UNAVAILABLE", { requestId, provider: "mail" })
      }

      await store.mailMessage.update({
        where: { id: mail.id },
        data: {
          status: "sent",
          messageId,
          sentAt: new Date(),
          deliveryEvents: { create: { status: "sent", providerEventId: messageId } }
        },
        select: { id: true }
      })
      logger.log({
        level: "info",
        event: "mail.sent",
        requestId,
        message: "Mail sent",
        data: { mailId: mail.id, template, status: "sent", provider: transport.name, messageId }
      })

      return { mailId: mail.id, messageId }
    }
  }
}
