import type { MailEnvelope, MailTransport } from "../transport"

export interface FakeMailTransport extends MailTransport {
  readonly sent: readonly MailEnvelope[]
  /** Следующие отправки падают с этой ошибкой; `null` возвращает успешную доставку. */
  failWith(error: Error | null): void
}

export function createFakeTransport(): FakeMailTransport {
  const sent: MailEnvelope[] = []
  let failure: Error | null = null

  return {
    name: "fake",
    sent,
    failWith(error) {
      failure = error
    },
    async send(envelope) {
      if (failure) throw failure
      sent.push({ ...envelope })
      return { messageId: `fake-${sent.length}` }
    }
  }
}
