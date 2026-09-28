import { randomUUID } from "node:crypto"
import type { ErrorCollectorAdapter, ErrorOccurrence } from "./types"

// Внешний сборщик по Sentry-протоколу без SDK: собственный GlitchTip или Sentry на сервере в РФ
// (журнал §34 п. 3, ADR-0011). Тот же приём, что у `storage/s3.ts`: адаптер знает только протокол,
// поэтому смена сборщика на другой совместимый — это другой адрес в DSN, а не другой код.

/** Версия протокола ingest, которую понимают и Sentry, и GlitchTip. */
const PROTOCOL_VERSION = 7

/** Имя клиента в заголовке авторизации: сборщик показывает его в событии. */
const CLIENT_NAME = "altera-error-collector/1"

/**
 * Сколько ждать ответа ingest-эндпоинта. Техническая константа модуля, а не продуктовый порог:
 * отправка идёт после ответа пользователю, а зависшее соединение держало бы задание или запрос.
 */
export const SENTRY_SEND_TIMEOUT_MS = 5_000

/** Сколько верхних кадров стека уходит в событие: длинный стек не помогает, а раздувает запись. */
export const SENTRY_STACK_FRAMES = 30

/** DSN не подходит: значение в сообщение не попадает — публичный ключ даёт право писать в проект. */
export class ErrorCollectorDsnError extends Error {
  constructor(reason: string) {
    super(`ERROR_COLLECTOR_DSN is not a valid Sentry DSN: ${reason}`)
    this.name = "ErrorCollectorDsnError"
  }
}

export interface SentryDsn {
  /** Адрес приёма envelope проекта: `<origin><path>/api/<project>/envelope/`. */
  envelopeUrl: string
  /** Публичный ключ проекта — уходит только в заголовок `X-Sentry-Auth`. */
  publicKey: string
  projectId: string
}

const projectIdPattern = /^[A-Za-z0-9_-]{1,64}$/

/**
 * `<scheme>://<public_key>@<host>[:port][/<path>]/<project_id>`. Legacy-часть с секретным ключом
 * (`key:secret@`) допускается ради совместимости старых DSN, но не используется: современный
 * ingest её игнорирует, и в запрос она не попадает.
 */
export function parseSentryDsn(dsn: string): SentryDsn {
  let url: URL
  try {
    url = new URL(dsn)
  } catch {
    throw new ErrorCollectorDsnError("not a URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ErrorCollectorDsnError("unsupported scheme")
  const publicKey = decodeURIComponent(url.username)
  if (!publicKey) throw new ErrorCollectorDsnError("no public key")

  const segments = url.pathname.split("/").filter((segment) => segment.length > 0)
  const projectId = segments.pop()
  if (!projectId || !projectIdPattern.test(projectId)) throw new ErrorCollectorDsnError("no project id")

  const prefix = segments.length > 0 ? `/${segments.join("/")}` : ""
  return { envelopeUrl: `${url.origin}${prefix}/api/${projectId}/envelope/`, publicKey, projectId }
}

export interface SentryErrorCollectorOptions {
  dsn: string
  /** Окружение сборщика: `development`, `production` — не значение секрета и не адрес. */
  environment?: string
  /** Ревизия сборки, если площадка её сообщает: сборщик связывает группу с версией. */
  release?: string
  fetch?: typeof fetch
  timeoutMs?: number
  eventId?: () => string
  now?: () => Date
}

interface SentryFrame {
  function?: string
  filename?: string
  lineno?: number
  colno?: number
}

const framePattern = /^\s*at\s+(?:(.+?)\s+\((.+)\)|(.+))$/
const locationPattern = /^(.*?)(?::(\d+))?(?::(\d+))?$/

/**
 * Кадры для `stacktrace`: Sentry ждёт их от самого старого к самому новому, а Node печатает
 * наоборот. Содержимое кадров берётся из уже маскированного стека вхождения
 * (`observability/privacy.ts`), новых источников данных здесь нет.
 */
export function sentryStackFrames(stack: string | null): SentryFrame[] {
  if (!stack) return []
  const frames: SentryFrame[] = []
  for (const line of stack.split("\n")) {
    const match = framePattern.exec(line)
    if (!match) continue
    const [, named, namedLocation, bareLocation] = match
    const location = (namedLocation ?? bareLocation ?? "").trim()
    const parsed = locationPattern.exec(location)
    const frame: SentryFrame = {}
    if (named) frame.function = named.trim()
    if (parsed?.[1]) frame.filename = parsed[1]
    if (parsed?.[2]) frame.lineno = Number(parsed[2])
    if (parsed?.[3]) frame.colno = Number(parsed[3])
    frames.push(frame)
    if (frames.length === SENTRY_STACK_FRAMES) break
  }
  return frames.reverse()
}

/** 32 шестнадцатеричных символа без дефисов — формат `event_id` протокола. */
const defaultEventId = (): string => randomUUID().replace(/-/g, "")

/**
 * Событие протокола из вхождения истории. ПДн здесь нет (`error-collector.md` §2 п. 5): сообщение
 * и стек приходят маскированными, контекст — поток, сервис, код словаря, маршрут по шаблону и
 * `requestId` как единственный мост к запросу (§2 п. 8). `server_name` не отправляется: имя хоста
 * сборщику не нужно, а в записи это лишние сведения об инфраструктуре.
 */
export function sentryEventPayload(
  occurrence: ErrorOccurrence,
  options: { eventId: string; environment?: string; release?: string }
): Record<string, unknown> {
  const tags: Record<string, string> = {
    stream: occurrence.stream,
    service: occurrence.service,
    code: occurrence.code,
    event: occurrence.event
  }
  if (occurrence.requestId) tags.request_id = occurrence.requestId
  if (occurrence.jobId) tags.job_id = occurrence.jobId

  const text = occurrence.message ?? occurrence.code
  const frames = sentryStackFrames(occurrence.stack)
  const hasException = occurrence.errorType !== null || frames.length > 0

  return {
    event_id: options.eventId,
    timestamp: occurrence.occurredAt.toISOString(),
    platform: "node",
    level: "error",
    logger: occurrence.service,
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.release ? { release: options.release } : {}),
    ...(occurrence.route ? { transaction: occurrence.route } : {}),
    // Группы внешнего сборщика совпадают с группами собственной истории: сигнатура T-089
    // (`error-collector.md` §2 п. 3) идёт как отпечаток, а не пересчитывается сборщиком.
    fingerprint: [occurrence.signature],
    tags,
    ...(hasException
      ? {
          exception: {
            values: [
              {
                type: occurrence.errorType ?? occurrence.code,
                value: text,
                ...(frames.length > 0 ? { stacktrace: { frames } } : {})
              }
            ]
          }
        }
      : { message: { formatted: text } })
  }
}

/**
 * Envelope ingest: заголовок конверта, заголовок элемента и само событие, разделённые переводом
 * строки. Поля `dsn` в заголовке конверта нет намеренно — публичный ключ уходит только в
 * `X-Sentry-Auth`, поэтому тело запроса не несёт учётных данных.
 */
export function sentryEnvelope(event: Record<string, unknown>, sentAt: Date): string {
  const payload = JSON.stringify(event)
  const header = JSON.stringify({ event_id: event.event_id, sent_at: sentAt.toISOString() })
  const itemHeader = JSON.stringify({
    type: "event",
    content_type: "application/json",
    length: Buffer.byteLength(payload)
  })
  return `${header}\n${itemHeader}\n${payload}\n`
}

export function createSentryErrorCollectorAdapter(options: SentryErrorCollectorOptions): ErrorCollectorAdapter {
  const dsn = parseSentryDsn(options.dsn)
  const send = options.fetch ?? fetch
  const eventId = options.eventId ?? defaultEventId
  const now = options.now ?? (() => new Date())
  const timeoutMs = options.timeoutMs ?? SENTRY_SEND_TIMEOUT_MS
  const authorization = [
    `Sentry sentry_version=${PROTOCOL_VERSION}`,
    `sentry_client=${CLIENT_NAME}`,
    `sentry_key=${dsn.publicKey}`
  ].join(", ")

  return {
    name: "sentry",

    async send(occurrence: ErrorOccurrence) {
      const event = sentryEventPayload(occurrence, {
        eventId: eventId(),
        environment: options.environment,
        release: options.release
      })
      const response = await send(dsn.envelopeUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-sentry-envelope",
          "x-sentry-auth": authorization
        },
        body: sentryEnvelope(event, now()),
        signal: AbortSignal.timeout(timeoutMs)
      })
      // Тело ответа отбрасывается, но читается: иначе соединение keep-alive остаётся занятым.
      await response.arrayBuffer().catch(() => undefined)
      // Отказ уходит наверх: `createErrorCollector` сохраняет свою историю и пишет `backend.error`.
      // Тело ответа в сообщение не попадает — там может быть эхо запроса.
      if (!response.ok) throw new Error(`Error collector rejected the event with HTTP ${response.status}`)
    }
  }
}
