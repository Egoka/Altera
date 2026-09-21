import type { ServiceName } from "../observability/logger"

/**
 * Какие события попадают в историю `backend.error` (`80-observability/error-collector.md` §2 п. 1):
 * необработанные исключения, сбои заданий и ошибки фронта. Ожидаемые ошибки словаря сюда не
 * попадают (§3) — сборщик отсекает их сам.
 */
export type ErrorSourceEvent = "error.unhandled" | "backend.error" | "job.failed" | "page.error"

/** Поток записи: сбои бэкенда и отдельная вкладка ошибок фронта без рабочих статусов (§2 п. 1). */
export type ErrorStream = "backend" | "page"

/** Одно вхождение в неизменяемой истории `backend.error` (#81). Идентификатора пользователя нет (§2 п. 8). */
export interface ErrorOccurrence {
  event: ErrorSourceEvent
  stream: ErrorStream
  service: ServiceName
  /** Код словаря, HTTP-статус страницы или имя класса исключения. */
  code: string
  /** Маршрут по шаблону или вид задания — без значений параметров (§2 п. 5). */
  route: string | null
  requestId: string | null
  jobId: string | null
  errorType: string | null
  message: string | null
  /** Стек после маскирования ПДн (`logging-policy.md` п. 4). */
  stack: string | null
  /** Сигнатура группы: сервис, код, маршрут и нормализованный стек (§2 п. 3). */
  signature: string
  occurredAt: Date
}

/**
 * Внешний сборщик ошибок с инфраструктурой в РФ (журнал §28.6, ADR-0011). Поставщик не выбран
 * (Q-01), поэтому единственная реализация — `noop`; смена провайдера меняет только адаптер.
 */
export interface ErrorCollectorAdapter {
  readonly name: string
  send(occurrence: ErrorOccurrence): Promise<void>
}

/** Группа вхождений одной сигнатуры за период (§2 п. 3). */
export interface ErrorGroup {
  signature: string
  stream: ErrorStream
  service: string
  code: string
  route: string | null
  occurrences: number
  firstSeenAt: Date
  lastSeenAt: Date
}

export interface ErrorGroupFilter {
  stream?: ErrorStream
  since: Date
  until: Date
}

/** Собственная история `backend.error`: только добавление и чтение, без правки записей (§2 п. 2). */
export interface ErrorHistory {
  append(occurrence: ErrorOccurrence): Promise<void>
  listGroups(filter: ErrorGroupFilter): Promise<ErrorGroup[]>
}
