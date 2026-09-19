import type { MailStore } from "../../src/mail/service"

export interface StoredEvent {
  status: string
  providerEventId?: string | null
  errorClass?: string | null
}

export interface StoredMessage {
  id: string
  template: string
  recipientEmail: string
  subject: string
  sanitizedBody: string
  status: string
  provider?: string | null
  messageId?: string | null
  deliveryErrorClass?: string | null
  sentAt?: Date | null
  objectType?: string | null
  objectId?: string | null
  events: StoredEvent[]
}

interface NestedEvents {
  deliveryEvents?: { create: StoredEvent }
}

export function createMemoryStore() {
  const messages = new Map<string, StoredMessage>()
  const store = {
    mailMessage: {
      async create({ data }: { data: Omit<StoredMessage, "id" | "events" | "status"> & NestedEvents }) {
        const { deliveryEvents, ...fields } = data
        const message: StoredMessage = {
          ...fields,
          id: `mail-${messages.size + 1}`,
          status: "queued",
          events: deliveryEvents ? [deliveryEvents.create] : []
        }
        messages.set(message.id, message)
        return { id: message.id }
      },
      async update({ where, data }: { where: { id: string }; data: Partial<StoredMessage> & NestedEvents }) {
        const message = messages.get(where.id)
        if (!message) throw new Error("not found")
        const { deliveryEvents, ...fields } = data
        Object.assign(message, fields)
        if (deliveryEvents) message.events.push(deliveryEvents.create)
        return { id: message.id }
      }
    }
  }
  return { store: store as unknown as MailStore, messages }
}
