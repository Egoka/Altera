// Коды типа `metric` из `docs/spec/00-registries/events-and-logs.md`: счётчики продукта,
// которые собираются в агрегаты, а не в журнал операций. Бижекция проверяется тестом реестра.
export const METRIC_EVENT_CODES = [
  "bookmark.add",
  "bookmark.remove",
  "follow.add",
  "follow.remove",
  "search.query",
  "search.zero_results",
  "checkout.started",
  "checkout.succeeded",
  "checkout.failed",
  "registration",
  "author.profile.completed",
  "translation.published",
  "page.error",
  "article.open",
  "article.read.qualified",
  "article.read.repeat",
  "article.share.create",
  "article.share.open",
  "author.profile.open",
  "author.share.open"
] as const

export type MetricEventCode = (typeof METRIC_EVENT_CODES)[number]

export function isMetricEventCode(value: unknown): value is MetricEventCode {
  return typeof value === "string" && METRIC_EVENT_CODES.includes(value as MetricEventCode)
}
