import pino, { type DestinationStream } from "pino"
import { isLogEventCode, type LogEventCode } from "./log-events"
import { sanitizeLogValue } from "./privacy"

export type LogLevel = "debug" | "info" | "warn" | "error"
export type ServiceName = "api" | "web" | "worker"

export type LogCorrelation = { requestId: string; jobId?: never } | { jobId: string; requestId?: never }

export type LogEntry = LogCorrelation & {
  level: LogLevel
  event: LogEventCode
  message: string
  data?: Readonly<Record<string, unknown>>
  error?: unknown
}

export interface AppLogger {
  log(entry: LogEntry): void
}

interface AppLoggerOptions {
  service: ServiceName
  environment: string
  destination?: DestinationStream
  now?: () => Date
}

export function createAppLogger(options: AppLoggerOptions): AppLogger {
  const now = options.now ?? (() => new Date())
  const target = pino(
    {
      base: { service: options.service, environment: options.environment },
      messageKey: "message",
      formatters: { level: (label) => ({ level: label }) },
      timestamp: () => `,"time":"${now().toISOString()}"`
    },
    options.destination
  )

  return {
    log(entry) {
      if (!isLogEventCode(entry.event)) throw new Error("Unknown log event")

      const hasRequestId = typeof entry.requestId === "string" && entry.requestId.length > 0
      const hasJobId = typeof entry.jobId === "string" && entry.jobId.length > 0
      if (hasRequestId === hasJobId) throw new Error("Log entry must have exactly one correlation key")

      const { level, message, ...fields } = entry
      const safeFields = sanitizeLogValue(fields) as Record<string, unknown>
      const safeMessage = sanitizeLogValue(message) as string
      target[level](safeFields, safeMessage)
    }
  }
}
