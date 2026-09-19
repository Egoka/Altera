import { randomUUID } from "node:crypto"
import type { MailTransport } from "../transport"

/**
 * Локальный транспорт без доставки: письмо никуда не печатается. Безопасные метаданные
 * (шаблон, статус, messageId, провайдер) остаются только в структурных логах mail-сервиса.
 */
export function createConsoleTransport(): MailTransport {
  return {
    name: "console",
    async send() {
      return { messageId: `console-${randomUUID()}` }
    }
  }
}
