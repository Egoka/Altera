import { createNoopErrorCollectorAdapter } from "./noop"
import { createSentryErrorCollectorAdapter } from "./sentry"
import type { ErrorCollectorAdapter } from "./types"

type ErrorCollectorEnv = Readonly<Record<string, string | undefined>>

/** Ревизия сборки как `release` сборщика — тот же формат, что у `revision` в `/health`. */
const commitPattern = /^[0-9a-f]{40}$/

function sentryFromEnv(env: ErrorCollectorEnv): ErrorCollectorAdapter {
  const dsn = env.ERROR_COLLECTOR_DSN
  // Сообщение не повторяет значение: публичный ключ DSN даёт право писать в проект сборщика.
  if (!dsn) throw new Error("ERROR_COLLECTOR_DSN is required for ERROR_COLLECTOR_DRIVER=sentry")
  const commit = env.RENDER_GIT_COMMIT
  return createSentryErrorCollectorAdapter({
    dsn,
    environment: env.ERROR_COLLECTOR_ENVIRONMENT || env.NODE_ENV || undefined,
    release: env.ERROR_COLLECTOR_RELEASE || (commit && commitPattern.test(commit) ? commit : undefined)
  })
}

/**
 * `ERROR_COLLECTOR_DRIVER` выбирает адаптер внешнего сборщика: `noop` без внешнего сервиса и
 * `sentry` — Sentry-протокол для собственного GlitchTip/Sentry (журнал §34 п. 3). По умолчанию во
 * всех окружениях остаётся `noop`: развёртывание сборщика отложено вместе с хостингом (§34 п. 1),
 * а без внешнего сервиса система работает — история ошибок остаётся собственной.
 */
export function createErrorCollectorAdapterFromEnv(env: ErrorCollectorEnv): ErrorCollectorAdapter {
  switch (env.ERROR_COLLECTOR_DRIVER) {
    case undefined:
    case "":
    case "noop":
      return createNoopErrorCollectorAdapter()
    case "sentry":
      return sentryFromEnv(env)
    default:
      throw new Error("Unknown ERROR_COLLECTOR_DRIVER")
  }
}
