/**
 * Адаптер «провайдер не настроен» для описания изображений: `real` на YandexGPT в объём T-067
 * не входит (выбор модели — отдельный проход), а `fake` в production запрещён. Такой адаптер
 * не выдумывает описание: `alt` остаётся пустым, задание повторяется очередью.
 *
 * Тот же приём применён в AI-проверке (`ai/adapters/unavailable.ts`) и в почте
 * (`mail/transports/unconfigured.ts`): молчаливого успеха вместо результата быть не должно.
 */

import type { AiAltAdapter } from "../types"

export class AiAltProviderNotConfiguredError extends Error {
  constructor() {
    super("AI alt provider is not configured")
    this.name = "AiAltProviderNotConfiguredError"
  }
}

export function createUnavailableAiAltAdapter(): AiAltAdapter {
  return {
    name: "unavailable",
    model: "none",
    promptVersion: "none",
    async describe() {
      throw new AiAltProviderNotConfiguredError()
    }
  }
}
