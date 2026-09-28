/**
 * `fake`-реализация AI-проверки: детерминированные вердикты по фикстуре (T-048, §32 п. 3).
 *
 * Случайности нет: один и тот же вход всегда даёт один и тот же вердикт. Источник вердикта
 * выбирается в таком порядке:
 *
 * 1. фикстура, заданная вызовом `setFixture(translationId, …)` — так работают тесты;
 * 2. маркер в тексте подачи `ai-check-fixture: <слова>` — так работает локальная разработка и
 *    браузерные сценарии, где подачу создаёт не тест, а редактор;
 * 3. иначе `publish` — «при неуверенности модели статья публикуется»
 *    (`docs/spec/40-admin/ai-check-criteria.md` §3 п. 1).
 *
 * Текст причины у двойника — заготовка, а не утверждённая владельцем формулировка письма:
 * утверждены только названия категорий (журнал §32 п. 1). В production `fake` запрещён
 * (`config.ts`), поэтому автору эта заготовка не показывается.
 */

import type { Locale } from "../../generated/prisma"
import { aiCheckCategoryTitle } from "../reasons"
import {
  isAiCheckReasonCategory,
  type AiCheckAdapter,
  type AiCheckEvidence,
  type AiCheckReason,
  type AiCheckReasonCategory,
  type AiCheckResult,
  type AiCheckSubmission,
  type AiCheckVerdict
} from "../types"

export const FAKE_AI_CHECK_MARKER = "ai-check-fixture:"
export const FAKE_AI_CHECK_MODEL = "fake-check"
export const FAKE_AI_CHECK_PROMPT_VERSION = "fake-1"

/** Ожидаемый исход одной подачи. */
export interface FakeAiCheckFixture {
  verdict: AiCheckVerdict
  /** Категории причин при отказе; при `publish` игнорируются. */
  categories?: readonly AiCheckReasonCategory[]
  adult?: boolean
  manipulationAttempt?: boolean
  /** Провайдер «недоступен»: проверка падает, задание повторяет очередь. */
  unavailable?: boolean
}

export interface FakeAiCheckAdapter extends AiCheckAdapter {
  /** Все поданные на проверку подачи в порядке вызовов — вход для проверок в тестах. */
  readonly submissions: readonly AiCheckSubmission[]
  setFixture(translationId: string, fixture: FakeAiCheckFixture): void
  reset(): void
}

export class FakeAiCheckUnavailableError extends Error {
  constructor() {
    super("Fake AI check provider is unavailable")
    this.name = "FakeAiCheckUnavailableError"
  }
}

const FAKE_REASON_TEXT: Readonly<Record<Locale, string>> = {
  ru: "проверка нашла в подаче признаки этой категории. Исправьте материал и отправьте снова.",
  en: "the submission shows signs of this category. Fix the material and submit it again."
}

/**
 * Разбор маркера: строка вида `ai-check-fixture: reject illegal spam_ads adult manipulation`.
 * Неизвестные слова игнорируются — двойник не должен падать на опечатке в черновике.
 */
export function parseFakeAiCheckMarker(text: string): FakeAiCheckFixture | null {
  const at = text.indexOf(FAKE_AI_CHECK_MARKER)
  if (at < 0) return null

  const line = text.slice(at + FAKE_AI_CHECK_MARKER.length).split("\n")[0]
  const words = line
    .trim()
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
  const categories = words.filter(isAiCheckReasonCategory)

  return {
    verdict: words.includes("reject") || categories.length > 0 ? "reject" : "publish",
    categories,
    adult: words.includes("adult"),
    manipulationAttempt: words.includes("manipulation"),
    unavailable: words.includes("unavailable")
  }
}

function submissionText(submission: AiCheckSubmission): string {
  return [submission.title, submission.dek ?? "", submission.blocks].join("\n")
}

/** Фрагмент подачи для evidence: первый непустой блок, обрезанный до одной строки. */
function firstFragment(submission: AiCheckSubmission): string {
  const candidate = submission.blocks.split("\n").find((line) => line.trim().length > 0) ?? submission.title
  return candidate.trim().slice(0, 200)
}

function toReasons(fixture: FakeAiCheckFixture, locale: Locale): AiCheckReason[] {
  // Отказ без указанной категории — несоответствие правилам журнала: категория 6 покрывает
  // «иные правила публикации» (`ai-check-criteria.md` §4.6).
  const fallback: readonly AiCheckReasonCategory[] = ["topic_rules"]
  const categories = fixture.categories && fixture.categories.length > 0 ? fixture.categories : fallback
  return categories.map((category) => ({
    category,
    text: `${aiCheckCategoryTitle(category, locale).toLowerCase()} — ${FAKE_REASON_TEXT[locale]}`
  }))
}

export function createFakeAiCheckAdapter(): FakeAiCheckAdapter {
  const submissions: AiCheckSubmission[] = []
  const fixtures = new Map<string, FakeAiCheckFixture>()

  return {
    name: "fake",
    model: FAKE_AI_CHECK_MODEL,
    promptVersion: FAKE_AI_CHECK_PROMPT_VERSION,
    submissions,
    setFixture(translationId, fixture) {
      fixtures.set(translationId, fixture)
    },
    reset() {
      submissions.length = 0
      fixtures.clear()
    },
    async check(submission) {
      submissions.push(submission)
      const fixture = fixtures.get(submission.translationId) ?? parseFakeAiCheckMarker(submissionText(submission))
      if (fixture?.unavailable) throw new FakeAiCheckUnavailableError()

      const verdict: AiCheckVerdict = fixture?.verdict ?? "publish"
      const reasons = fixture && verdict === "reject" ? toReasons(fixture, submission.locale) : []
      const evidence: AiCheckEvidence[] = reasons.map((reason) => ({
        category: reason.category,
        fragment: firstFragment(submission)
      }))

      const result: AiCheckResult = {
        verdict,
        reasons,
        evidence,
        manipulationAttempt: fixture?.manipulationAttempt ?? false,
        adult: fixture?.adult ?? submission.adultMarkedByAuthor,
        model: FAKE_AI_CHECK_MODEL,
        promptVersion: FAKE_AI_CHECK_PROMPT_VERSION,
        // Двойник ничего не стоит: агрегат стоимости всё равно пополняется, потому что число
        // записей за период считается по нему же.
        costMinor: 0
      }
      return result
    }
  }
}
