import { randomUUID } from "node:crypto"
import type { AppLogger } from "../observability/logger"
import { BACKUP_KINDS } from "./backups"
import { COMPONENT_NAMES } from "./components"
import type { Health } from "./readiness"

/** Оповещения получают все активные `owner` и `admin` (журнал §28.5, §40 п. 2). */
export const ALERT_ROLES = ["owner", "admin"] as const
export type AlertRole = (typeof ALERT_ROLES)[number]

export interface AlertRecipient {
  id: string
  role: AlertRole
}

export interface HealthAlert {
  /** Коды причин: `component.<имя>.down`, `backup.<вид>.overdue|unknown`, `migrations.incomplete`. */
  reasons: readonly string[]
  recipients: readonly AlertRecipient[]
  /**
   * Канал доставки оповещений — Отложено (журнал §40 п. 1): оповещение формируется, получатели
   * известны, отправки нет. Подставлять здесь почту нельзя — это решение владельца.
   */
  channel: "deferred"
}

/**
 * Основания оповещения из этой задачи (`health-and-alerts.md` п. 6): недоступность базы,
 * провайдера платежей, AI, почты или хранилища медиа и просроченная резервная копия. Возраст
 * очереди заданий и всплеск `INTERNAL_ERROR` приходят из своих подсистем (`jobs.md` п. 4,
 * `error-collector.md`) и в этот расчёт не входят.
 */
export function healthAlertReasons(health: Health): string[] {
  const reasons: string[] = []
  if (!health.checks.migrations) reasons.push("migrations.incomplete")
  for (const name of COMPONENT_NAMES) {
    if (health.components[name].status === "down") reasons.push(`component.${name}.down`)
  }
  for (const kind of BACKUP_KINDS) {
    const status = health.backups[kind].status
    if (status === "overdue" || status === "unknown") reasons.push(`backup.${kind}.${status}`)
  }
  return reasons
}

export interface StaffRecipientsClient {
  user: {
    findMany(args: {
      where: { role: { in: readonly AlertRole[] }; isServiceAccount: true; archivedAt: null }
      select: { id: true; role: true }
      orderBy: { createdAt: "asc" }
    }): Promise<readonly { id: string; role: string }[]>
  }
}

/**
 * Контакты берутся из служебных записей активных `owner` и `admin`, отдельный список адресов не
 * ведётся (журнал §40 п. 2). В оповещение попадают идентификатор и роль: адрес — ПДн, в журнал
 * состояния он не пишется (`logging-policy.md`, спецификация п. 1 «без ПДн и секретов»).
 */
export const createStaffRecipients = (client: StaffRecipientsClient) => async (): Promise<AlertRecipient[]> => {
  const rows = await client.user.findMany({
    where: { role: { in: ALERT_ROLES }, isServiceAccount: true, archivedAt: null },
    select: { id: true, role: true },
    orderBy: { createdAt: "asc" }
  })
  return rows
    .filter((row): row is { id: string; role: AlertRole } => (ALERT_ROLES as readonly string[]).includes(row.role))
    .map((row) => ({ id: row.id, role: row.role }))
}

export interface HealthAlertsOptions {
  recipients: () => Promise<readonly AlertRecipient[]>
  logger: AppLogger
  requestId?: () => string
  /** Append-only история для `/admin/errors`; сбой записи не влияет на readiness и оповещение. */
  history?: (health: Health) => Promise<void>
}

/**
 * Запись `system.health` (#53) и оповещение получателям. Пишется при смене набора причин, а не на
 * каждой проверке: `/health` опрашивают постоянно, и запись на каждый опрос забила бы журнал, не
 * добавив нового. Уровни — `info` и `warn`: состояние не аудит (спецификация п. 8).
 */
export function createHealthAlerts(options: HealthAlertsOptions): (health: Health) => Promise<HealthAlert | null> {
  const nextRequestId = options.requestId ?? (() => `health:${randomUUID()}`)
  let reported: string | undefined

  return async (health) => {
    const reasons = healthAlertReasons(health)
    const signature = reasons.join(" ")
    if (signature === reported) return null
    const first = reported === undefined
    reported = signature

    if (options.history) {
      try {
        await options.history(health)
      } catch (error: unknown) {
        options.logger.log({
          level: "error",
          event: "backend.error",
          requestId: nextRequestId(),
          message: "Health history write failed",
          error
        })
      }
    }

    if (reasons.length === 0) {
      // Первая проверка здоровой системы — не «возврат в норму»: сообщать не о чем.
      if (!first) {
        options.logger.log({
          level: "info",
          event: "system.health",
          requestId: nextRequestId(),
          message: "System health recovered",
          data: { status: health.status }
        })
      }
      return null
    }

    let recipients: readonly AlertRecipient[] = []
    let recipientsUnavailable = false
    try {
      recipients = await options.recipients()
    } catch {
      // Список получателей читается из базы: её недоступность — сама причина оповещения.
      recipientsUnavailable = true
    }

    options.logger.log({
      level: "warn",
      event: "system.health",
      requestId: nextRequestId(),
      message: "System health degraded",
      data: {
        status: health.status,
        reasons,
        channel: "deferred",
        recipientCount: recipients.length,
        recipients: recipients.map((recipient) => ({ id: recipient.id, role: recipient.role })),
        ...(recipientsUnavailable ? { recipientsUnavailable } : {})
      }
    })

    return { reasons, recipients, channel: "deferred" }
  }
}
