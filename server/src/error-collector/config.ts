import { createNoopErrorCollectorAdapter } from "./noop"
import type { ErrorCollectorAdapter } from "./types"

type ErrorCollectorEnv = Readonly<Record<string, string | undefined>>

/**
 * `ERROR_COLLECTOR_DRIVER` выбирает адаптер внешнего сборщика. Пока владелец не выбрал поставщика
 * (Q-01), доступен только `noop`, и он же используется по умолчанию во всех окружениях: без
 * внешнего сервиса система работает, а история ошибок остаётся собственной.
 */
export function createErrorCollectorAdapterFromEnv(env: ErrorCollectorEnv): ErrorCollectorAdapter {
  switch (env.ERROR_COLLECTOR_DRIVER) {
    case undefined:
    case "":
    case "noop":
      return createNoopErrorCollectorAdapter()
    default:
      throw new Error("Unknown ERROR_COLLECTOR_DRIVER")
  }
}
