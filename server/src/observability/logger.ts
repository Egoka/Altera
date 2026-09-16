import pino, { type DestinationStream } from "pino"
import { isLogEventCode, type LogEventCode } from "./log-events"
import { sanitizeLogValue } from "./privacy"

export type LogLevel = "debug" | "info" | "warn" | "error"
export type ServiceName = "api" | "web" | "worker"

export type LogCorrelation =
  | { requestId: string; jobId?: never; originRequestId?: never }
  | { jobId: string; originRequestId?: string; requestId?: never }

interface BaseLogEntry {
  level: LogLevel
  message: string
  data?: Readonly<Record<string, unknown>>
  error?: unknown
}

type HttpRequestLogEntry = BaseLogEntry & {
  level: "info"
  event: "http.request"
  requestId: string
  jobId?: never
  originRequestId?: never
  route: string
  status: number
  durationMs: number
  userId: string | null
  role: string | null
}

type GeneralLogEntry = BaseLogEntry &
  LogCorrelation & {
    event: Exclude<LogEventCode, "http.request">
  }

export type LogEntry = HttpRequestLogEntry | GeneralLogEntry

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

      const hasRequestId = "requestId" in entry
      const hasJobId = "jobId" in entry
      const requestIdIsValid = !hasRequestId || (typeof entry.requestId === "string" && entry.requestId.length > 0)
      const jobIdIsValid = !hasJobId || (typeof entry.jobId === "string" && entry.jobId.length > 0)
      if (entry.event === "http.request" && !hasRequestId) throw new Error("http.request requires requestId")
      const hasOriginRequestId = "originRequestId" in entry
      if (
        hasOriginRequestId &&
        (!hasJobId || typeof entry.originRequestId !== "string" || entry.originRequestId.length === 0)
      ) {
        throw new Error("originRequestId requires jobId")
      }
      if (hasRequestId === hasJobId || !requestIdIsValid || !jobIdIsValid) {
        throw new Error("Log entry must have exactly one correlation key")
      }

      const { level, message, ...fields } = entry
      const safeFields = sanitizeLogValue(fields) as Record<string, unknown>
      const safeMessage = sanitizeLogValue(message) as string
      target[level](safeFields, safeMessage)
    }
  }
}
