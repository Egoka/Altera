import { randomUUID } from "node:crypto"
import { isApiError } from "../errors/graphql-error"
import type { AppLogger, ServiceName } from "../observability/logger"
import { sanitizeLogValue } from "../observability/privacy"
import { errorSignature } from "./signature"
import type { ErrorCollectorAdapter, ErrorHistory, ErrorOccurrence, ErrorSourceEvent } from "./types"

export interface BackendErrorInput {
  event: Exclude<ErrorSourceEvent, "page.error">
  service: ServiceName
  code: string
  route?: string | null
  requestId?: string | null
  jobId?: string | null
  error?: unknown
}

/** Поля `page.error` из реестра событий (#64): маршрут, код и `requestId` — без стека и ПДн. */
export interface PageErrorInput {
  route: string
  code: string
  requestId?: string | null
}

export type PageErrorField = "route" | "code" | "requestId"

export class PageErrorValidationError extends Error {
  constructor(readonly field: PageErrorField) {
    super(`Invalid page error field ${field}`)
    this.name = "PageErrorValidationError"
  }
}

export interface ErrorCollector {
  readonly adapter: string
  /** Сбой бэкенда: возвращает записанное вхождение или `null`, если это ожидаемая ошибка словаря. */
  capture(input: BackendErrorInput): Promise<ErrorOccurrence | null>
  capturePageError(input: PageErrorInput): Promise<ErrorOccurrence>
}

interface ErrorCollectorOptions {
  history: ErrorHistory
  adapter: ErrorCollectorAdapter
  logger: AppLogger
  now?: () => Date
}

export const PAGE_ERROR_ROUTE_MAX = 256
const pageErrorCodePattern = /^[A-Za-z0-9_.:-]{1,64}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface SafeErrorParts {
  errorType: string | null
  message: string | null
  stack: string | null
}

function safeErrorParts(error: unknown): SafeErrorParts {
  if (error === undefined || error === null) return { errorType: null, message: null, stack: null }
  const safe = sanitizeLogValue(error)
  if (typeof safe === "string") return { errorType: null, message: safe, stack: null }
  if (typeof safe !== "object" || safe === null) return { errorType: null, message: String(safe), stack: null }

  const record = safe as Record<string, unknown>
  const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null)
  return { errorType: text(record.type), message: text(record.message), stack: text(record.stack) }
}

/** Маршрут страницы без query и hash: значения параметров в историю не попадают (§2 п. 5). */
function normalizePageRoute(route: unknown): string {
  if (typeof route !== "string") throw new PageErrorValidationError("route")
  const path = route.split(/[?#]/, 1)[0] ?? ""
  if (!path.startsWith("/") || path.length > PAGE_ERROR_ROUTE_MAX) throw new PageErrorValidationError("route")
  return sanitizeLogValue(path) as string
}

export function createErrorCollector(options: ErrorCollectorOptions): ErrorCollector {
  const now = options.now ?? (() => new Date())

  function reportFailure(occurrence: ErrorOccurrence, stage: "history" | "adapter", error: unknown): void {
    // Сбой самого сборщика уходит только в журнал: повторный захват дал бы петлю.
    const correlation = occurrence.jobId
      ? { jobId: occurrence.jobId }
      : { requestId: occurrence.requestId ?? randomUUID() }
    options.logger.log({
      level: "error",
      event: "backend.error",
      ...correlation,
      message: stage === "history" ? "Error history write failed" : "Error collector adapter failed",
      data: { adapter: options.adapter.name, signature: occurrence.signature },
      error
    })
  }

  async function record(occurrence: ErrorOccurrence): Promise<ErrorOccurrence> {
    try {
      await options.history.append(occurrence)
    } catch (error: unknown) {
      reportFailure(occurrence, "history", error)
    }
    try {
      await options.adapter.send(occurrence)
    } catch (error: unknown) {
      reportFailure(occurrence, "adapter", error)
    }
    return occurrence
  }

  return {
    adapter: options.adapter.name,

    async capture(input) {
      // Ошибки словаря (`VALIDATION_ERROR`, `FORBIDDEN`, …) — не сбои и в сборщик не попадают (§3).
      // Исчерпанное задание — сбой при любом классе исключения: повторов больше не будет.
      if (input.event !== "job.failed" && input.error !== undefined && isApiError(input.error)) return null

      const parts = safeErrorParts(input.error)
      const route = input.route ? (sanitizeLogValue(input.route) as string) : null
      const occurrence: ErrorOccurrence = {
        event: input.event,
        stream: "backend",
        service: input.service,
        code: input.code,
        route,
        requestId: input.requestId ?? null,
        jobId: input.jobId ?? null,
        ...parts,
        signature: errorSignature({
          stream: "backend",
          service: input.service,
          code: input.code,
          route,
          stack: parts.stack
        }),
        occurredAt: now()
      }
      return record(occurrence)
    },

    async capturePageError(input) {
      const route = normalizePageRoute(input.route)
      if (typeof input.code !== "string" || !pageErrorCodePattern.test(input.code)) {
        throw new PageErrorValidationError("code")
      }
      const requestId = input.requestId ?? null
      if (requestId !== null && (typeof requestId !== "string" || !uuidPattern.test(requestId))) {
        throw new PageErrorValidationError("requestId")
      }

      const occurrence: ErrorOccurrence = {
        event: "page.error",
        stream: "page",
        service: "web",
        code: input.code,
        route,
        requestId,
        jobId: null,
        errorType: null,
        message: null,
        stack: null,
        signature: errorSignature({ stream: "page", service: "web", code: input.code, route, stack: null }),
        occurredAt: now()
      }
      return record(occurrence)
    }
  }
}
