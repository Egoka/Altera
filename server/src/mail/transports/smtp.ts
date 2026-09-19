import nodemailer from "nodemailer"
import type { MailTransport } from "../transport"

export interface SmtpTransportOptions {
  host: string
  port: number
  secure: boolean
  auth?: { user: string; pass: string }
}

export function createSmtpTransport(options: SmtpTransportOptions): MailTransport {
  const transporter = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: options.auth,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000
  })

  return {
    name: "smtp",
    async send(envelope) {
      const info = await transporter.sendMail({
        from: envelope.from,
        to: envelope.to,
        subject: envelope.subject,
        text: envelope.text,
        html: envelope.html
      })
      return { messageId: info.messageId ?? null }
    }
  }
}
