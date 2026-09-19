import type { MailTransport } from "./transport"
import { createConsoleTransport } from "./transports/console"
import { createFakeTransport } from "./transports/fake"
import { createSmtpTransport } from "./transports/smtp"
import { createUnconfiguredTransport } from "./transports/unconfigured"

export interface MailConfig {
  transport: MailTransport
  from: string
}

type MailEnv = Readonly<Record<string, string | undefined>>

const localFrom = "Altera <no-reply@localhost>"

function readPort(value: string | undefined): number {
  const port = Number(value)
  if (!value || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a port number")
  }
  return port
}

function createSmtpFromEnv(env: MailEnv): MailTransport {
  if (!env.SMTP_HOST) throw new Error("SMTP_HOST is required for MAIL_TRANSPORT=smtp")
  const port = readPort(env.SMTP_PORT)
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
    throw new Error("SMTP_USER and SMTP_PASSWORD must be set together")
  }

  return createSmtpTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE === "true",
    auth: env.SMTP_USER && env.SMTP_PASSWORD ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined
  })
}

export function createMailConfigFromEnv(env: MailEnv): MailConfig {
  const production = env.NODE_ENV === "production"
  const kind = env.MAIL_TRANSPORT
  const from = env.MAIL_FROM || localFrom

  switch (kind) {
    case undefined:
    case "":
      return { transport: production ? createUnconfiguredTransport() : createConsoleTransport(), from }
    case "console":
      return { transport: createConsoleTransport(), from }
    case "fake":
      if (production) throw new Error("MAIL_TRANSPORT=fake is not allowed in production")
      return { transport: createFakeTransport(), from }
    case "smtp":
      if (production && !env.MAIL_FROM) throw new Error("MAIL_FROM is required in production")
      return { transport: createSmtpFromEnv(env), from }
    default:
      throw new Error("Unknown MAIL_TRANSPORT")
  }
}
