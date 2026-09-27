/**
 * Выбор реализации AI-проверки по окружению — по образцу `mail/config.ts` и `storage/config.ts`.
 *
 * `real` (YandexGPT, журнал §34 п. 4) в объём T-048 не входит: до утверждения владельцем
 * `real`-проверка и автопубликация не включаются (журнал §32 п. 2), поэтому значение `real`
 * останавливает запуск, а не притворяется рабочим провайдером.
 */

import { createFakeAiCheckAdapter } from "./adapters/fake"
import { createUnavailableAiCheckAdapter } from "./adapters/unavailable"
import type { AiCheckAdapter } from "./types"

type AiEnv = Readonly<Record<string, string | undefined>>

export function createAiCheckAdapterFromEnv(env: AiEnv): AiCheckAdapter {
  const production = env.NODE_ENV === "production"

  switch (env.AI_CHECK_ADAPTER) {
    case undefined:
    case "":
      return production ? createUnavailableAiCheckAdapter() : createFakeAiCheckAdapter()
    case "fake":
      if (production) throw new Error("AI_CHECK_ADAPTER=fake is not allowed in production")
      return createFakeAiCheckAdapter()
    case "unavailable":
      return createUnavailableAiCheckAdapter()
    case "real":
      throw new Error("AI_CHECK_ADAPTER=real is not implemented: the provider awaits the owner's approval")
    default:
      throw new Error("Unknown AI_CHECK_ADAPTER")
  }
}
