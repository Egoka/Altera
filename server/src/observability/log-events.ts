export const LOG_EVENT_CODES = [
  "http.request",
  "auth.link.requested",
  "auth.login",
  "auth.login.failed",
  "session.refresh",
  "session.revoked",
  "session.reuse_detected",
  "rate_limit.hit",
  "translation.submit",
  "translation.withdraw",
  "translation.reedit",
  "ai.job.created",
  "ai.job.started",
  "ai.job.running",
  "ai.job.done",
  "ai.job.failed",
  "ranking.run.started",
  "ranking.run.done",
  "ranking.run.failed",
  "webhook.received",
  "webhook.processed",
  "webhook.failed",
  "subscription.activated",
  "subscription.deactivated",
  "subscription.expired",
  "subscription.renewed",
  "subscription.queued",
  "subscription.retry",
  "mail.queued",
  "mail.sent",
  "mail.failed",
  "job.failed",
  "job.stuck",
  "system.health",
  "error.unhandled",
  "plan.action.rejected",
  "support.request.created",
  "backend.error",
  "engagement.anomaly",
  "review.reply",
  "admin.enter"
] as const

export type LogEventCode = (typeof LOG_EVENT_CODES)[number]

export function isLogEventCode(value: unknown): value is LogEventCode {
  return typeof value === "string" && LOG_EVENT_CODES.includes(value as LogEventCode)
}
