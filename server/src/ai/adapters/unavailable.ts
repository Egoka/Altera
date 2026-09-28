/**
 * Адаптер «провайдер не настроен»: до утверждения владельцем `real`-проверка не включается
 * (журнал §32 п. 2), а `fake` в production запрещён. Такой адаптер не выносит вердикт вообще:
 * подача остаётся в `ai_check`, задание повторяется (`write-and-publish.md` §4, шаг 4).
 *
 * Тот же приём применён в почте (`mail/transports/unconfigured.ts`): молчаливого успеха
 * вместо доставки быть не должно.
 */

import type { AiCheckAdapter } from "../types"

export class AiCheckProviderNotConfiguredError extends Error {
  constructor() {
    super("AI check provider is not configured")
    this.name = "AiCheckProviderNotConfiguredError"
  }
}

export function createUnavailableAiCheckAdapter(): AiCheckAdapter {
  return {
    name: "unavailable",
    model: "none",
    promptVersion: "none",
    async check() {
      throw new AiCheckProviderNotConfiguredError()
    }
  }
}
