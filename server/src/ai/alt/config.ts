/**
 * Выбор реализации AI-описания по окружению — по образцу `ai/config.ts`.
 *
 * `real` (YandexGPT, журнал §34 п. 4) в объём T-067 не входит: выбор модели, языки и стоимость —
 * отдельный проход (`upload-pipeline.md` п. 6а), поэтому значение `real` останавливает запуск,
 * а не притворяется рабочим провайдером.
 */

import { createFakeAiAltAdapter } from "./adapters/fake"
import { createUnavailableAiAltAdapter } from "./adapters/unavailable"
import type { AiAltAdapter } from "./types"

type AiEnv = Readonly<Record<string, string | undefined>>

export function createAiAltAdapterFromEnv(env: AiEnv): AiAltAdapter {
  const production = env.NODE_ENV === "production"

  switch (env.AI_ALT_ADAPTER) {
    case undefined:
    case "":
      return production ? createUnavailableAiAltAdapter() : createFakeAiAltAdapter()
    case "fake":
      if (production) throw new Error("AI_ALT_ADAPTER=fake is not allowed in production")
      return createFakeAiAltAdapter()
    case "unavailable":
      return createUnavailableAiAltAdapter()
    case "real":
      throw new Error("AI_ALT_ADAPTER=real is not implemented: the model choice is a separate pass")
    default:
      throw new Error("Unknown AI_ALT_ADAPTER")
  }
}
