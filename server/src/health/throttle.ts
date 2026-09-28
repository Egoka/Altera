/**
 * Проверки зависимостей — лёгкие вызовы не чаще раза в минуту, результат кешируется
 * (`80-observability/health-and-alerts.md` п. 2). Готовность базы, миграций и кеша под это
 * правило не попадает: платформе она нужна свежей на каждый опрос, и её кеширует
 * `createHealthCheck` отдельным коротким сроком.
 */
export const DEPENDENCY_CHECK_INTERVAL_MS = 60_000

/**
 * Кеш результата на `intervalMs` с одним вызовом на всех: параллельные проверки ждут уже
 * запущенный вызов, а не добавляют свой. Отказ не кешируется — следующая проверка пробует снова.
 */
export function throttleAsync<T>(call: () => Promise<T>, intervalMs = DEPENDENCY_CHECK_INTERVAL_MS): () => Promise<T> {
  let cached: { value: T } | undefined
  let expiresAt = 0
  let inFlight: Promise<T> | undefined

  return () => {
    if (cached && Date.now() < expiresAt) return Promise.resolve(cached.value)
    if (inFlight) return inFlight
    inFlight = call().then(
      (value) => {
        cached = { value }
        expiresAt = Date.now() + intervalMs
        inFlight = undefined
        return value
      },
      (error: unknown) => {
        inFlight = undefined
        throw error
      }
    )
    return inFlight
  }
}
