export interface MailEnvelope {
  from: string
  to: string
  subject: string
  text: string
  html: string
}

export interface MailDelivery {
  messageId: string | null
}

/** Способ доставки письма. Реализации не пишут в логи адрес и содержимое. */
export interface MailTransport {
  readonly name: string
  send(envelope: MailEnvelope): Promise<MailDelivery>
}
