import type { ErrorCollectorAdapter } from "./types"

/**
 * Реализация без внешнего сервиса: сборщик выбран (§34 п. 3), но его развёртывание отложено вместе
 * с хостингом (§34 п. 1, T-103), поэтому это значение по умолчанию во всех окружениях.
 * История `backend.error` пишется всё равно — раздел ошибок работает на собственных данных.
 */
export function createNoopErrorCollectorAdapter(): ErrorCollectorAdapter {
  return {
    name: "noop",
    send: async () => undefined
  }
}
