import type { ErrorCollectorAdapter } from "./types"

/**
 * Реализация без внешнего сервиса: поставщик сборщика с инфраструктурой в РФ не выбран (Q-01).
 * История `backend.error` пишется всё равно — раздел ошибок работает на собственных данных.
 */
export function createNoopErrorCollectorAdapter(): ErrorCollectorAdapter {
  return {
    name: "noop",
    send: async () => undefined
  }
}
