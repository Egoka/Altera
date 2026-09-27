/**
 * Интерфейс адаптера AI-проверки допустимости подачи (T-048).
 *
 * Вердикт бинарный — «публиковать» / «не публиковать» (журнал #41–42); балла нет. Состав входа
 * и формат ответа заданы `docs/spec/40-admin/ai-check-criteria.md` §2 и §5, категории причин —
 * §4 того же документа и `docs/spec/20-public/legal-content-rules.md` §4.
 *
 * Реализации: `fake` (детерминированные вердикты по фикстуре) и `unavailable` (провайдер
 * не утверждён). `real` на YandexGPT (журнал §34 п. 4) в объём T-048 не входит: до утверждения
 * владельцем `real`-проверка не включается (журнал §32 п. 2).
 */

import type { Locale } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"

/**
 * Шесть категорий причин отказа (`ai-check-criteria.md` §4, `legal-content-rules.md` §4;
 * журнал §32 п. 1). Порядок повторяет порядок разделов критериев.
 */
export const AI_CHECK_REASON_CATEGORIES = [
  "rights",
  "illegal",
  "spam_ads",
  "third_party_pd",
  "age",
  "topic_rules"
] as const

export type AiCheckReasonCategory = (typeof AI_CHECK_REASON_CATEGORIES)[number]

export function isAiCheckReasonCategory(value: unknown): value is AiCheckReasonCategory {
  return typeof value === "string" && (AI_CHECK_REASON_CATEGORIES as readonly string[]).includes(value)
}

/** Роль изображения в подаче: обложка проверяется вместе с остальными (журнал §43 п. 1). */
export type AiCheckImageRole = "cover" | "body"

/**
 * Изображение подачи: подпись, атрибуция и лицензия живут в медиафайле, а не в документе
 * (журнал §29.13, §31 п. 1), поэтому в подачу они попадают отдельным перечнем.
 */
export interface AiCheckImage {
  assetId: string
  role: AiCheckImageRole
  alt: string | null
  caption: string | null
  attribution: string
  license: string
  licenseNote: string | null
}

/**
 * Подача, уходящая провайдеру. Имени и e-mail автора здесь нет и быть не может:
 * `legal-content-rules.md` §4 и `write-and-publish.md` шаг 3. Перечень полей закрытый —
 * его состав проверяет тест экстрактора (критерий готовности 2 T-048).
 */
export interface AiCheckSubmission {
  translationId: string
  revisionId: string
  /** Язык версии: на нём же пишется текст причины (журнал §24.3). */
  locale: Locale
  title: string
  dek: string | null
  /** Текст статьи в порядке блоков. */
  blocks: string
  /** Выбранная рубрика. */
  sectionSlug: string | null
  /** Теги в сохранённом порядке, первый — главный (журнал §21.22). */
  tags: readonly string[]
  images: readonly AiCheckImage[]
  /** Пометка 18+, если её поставил автор (журнал §43 п. 8). */
  adultMarkedByAuthor: boolean
}

export type AiCheckVerdict = "publish" | "reject"

/** Причина отказа: код категории и текст для автора (`ai-check-criteria.md` §5). */
export interface AiCheckReason {
  category: AiCheckReasonCategory
  text: string
}

/** Фрагмент подачи, на котором основан отказ. Виден `moderator`/`reviewer` и `owner` (§5). */
export interface AiCheckEvidence {
  category: AiCheckReasonCategory
  fragment: string
}

export interface AiCheckResult {
  verdict: AiCheckVerdict
  /** При `publish` — пусто; при `reject` указываются все найденные категории (§3 п. 4). */
  reasons: readonly AiCheckReason[]
  evidence: readonly AiCheckEvidence[]
  /** Попытка манипулировать проверкой (журнал §43 п. 2). */
  manipulationAttempt: boolean
  /** Пометка 18+ по решению проверки; сама по себе не отказ (журнал §43 п. 8). */
  adult: boolean
  model: string
  promptVersion: string
  /**
   * Стоимость обращения в копейках. Попадает только в агрегат по периоду: у отдельной записи
   * стоимость не хранится и никому не показывается (журнал §27.4).
   */
  costMinor: number
}

export interface AiCheckAdapter {
  readonly name: string
  readonly model: string
  /** Версия промпта и критериев; пишется в каждую запись проверки (`ai-check-criteria.md` §6). */
  readonly promptVersion: string
  check(submission: AiCheckSubmission): Promise<AiCheckResult>
}

/**
 * Недоступность провайдера в ответе API — `PROVIDER_UNAVAILABLE: ai` (журнал §29.3,
 * `error-dictionary.md` #11). Задание при этом повторяется очередью, вердикт не выносится.
 */
export function aiProviderUnavailableError(requestId: string): Error {
  return createApiError("PROVIDER_UNAVAILABLE", { requestId, provider: "ai" })
}
