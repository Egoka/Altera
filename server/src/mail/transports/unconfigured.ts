import type { MailTransport } from "../transport"

class MailTransportNotConfigured extends Error {
  override name = "MailTransportNotConfigured"
}

/** Production без явного MAIL_TRANSPORT: письма не теряются молча в console, а падают как недоступный провайдер. */
export function createUnconfiguredTransport(): MailTransport {
  return {
    name: "unconfigured",
    async send() {
      throw new MailTransportNotConfigured("MAIL_TRANSPORT is not configured")
    }
  }
}
