/**
 * `fake`-реализация AI-описания изображения: детерминированный текст без обращения к провайдеру.
 *
 * Случайности нет: одни и те же байты всегда дают одно и то же описание. Источник описания
 * выбирается в таком порядке:
 *
 * 1. фикстура, заданная вызовом `setFixture(assetId, …)` — так работают тесты;
 * 2. иначе заготовка со сторонами изображения — так работает локальная разработка.
 *
 * Текст заготовки — не утверждённая владельцем формулировка: выбор модели, языки и качество
 * описания вынесены в отдельный проход (журнал §29.12, `upload-pipeline.md` п. 6а). В production
 * `fake` запрещён (`config.ts`), поэтому читателю эта заготовка не показывается.
 */

import type { AiAltAdapter, AiAltImage, AiAltResult } from "../types"

export const FAKE_AI_ALT_MODEL = "fake-alt"
export const FAKE_AI_ALT_PROMPT_VERSION = "fake-1"

/** Ожидаемый исход одного описания. */
export interface FakeAiAltFixture {
  alt?: string
  /** Провайдер «недоступен»: шаг падает, задание повторяет очередь. */
  unavailable?: boolean
}

export interface FakeAiAltAdapter extends AiAltAdapter {
  /** Все изображения, поданные на описание, в порядке вызовов — вход для проверок в тестах. */
  readonly described: readonly AiAltImage[]
  setFixture(assetId: string, fixture: FakeAiAltFixture): void
  reset(): void
}

export class FakeAiAltUnavailableError extends Error {
  constructor() {
    super("Fake AI alt provider is unavailable")
    this.name = "FakeAiAltUnavailableError"
  }
}

/** Заготовка описания: стороны мастера, если конвейер их уже знает, иначе только вид файла. */
function placeholderAlt(image: AiAltImage): string {
  const size = image.width && image.height ? ` ${image.width}×${image.height}` : ""
  return `Изображение${size}`
}

export function createFakeAiAltAdapter(): FakeAiAltAdapter {
  const described: AiAltImage[] = []
  const fixtures = new Map<string, FakeAiAltFixture>()

  return {
    name: "fake",
    model: FAKE_AI_ALT_MODEL,
    promptVersion: FAKE_AI_ALT_PROMPT_VERSION,
    described,
    setFixture(assetId, fixture) {
      fixtures.set(assetId, fixture)
    },
    reset() {
      described.length = 0
      fixtures.clear()
    },
    async describe(image) {
      described.push(image)
      const fixture = fixtures.get(image.assetId)
      if (fixture?.unavailable) throw new FakeAiAltUnavailableError()

      const result: AiAltResult = {
        alt: fixture?.alt ?? placeholderAlt(image),
        model: FAKE_AI_ALT_MODEL,
        promptVersion: FAKE_AI_ALT_PROMPT_VERSION,
        // Двойник ничего не стоит: агрегат всё равно пополняется, потому что число описаний за
        // период считается по нему же.
        costMinor: 0
      }
      return result
    }
  }
}
