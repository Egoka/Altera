/**
 * Названия шести категорий причин отказа и сборка комментария автору.
 *
 * Названия взяты из утверждённых документов — `docs/spec/20-public/legal-content-rules.md` §4 и
 * `docs/spec/40-admin/ai-check-criteria.md` §4 (журнал §32 п. 1), — и здесь не придумываются.
 * Английские названия — перевод тех же шести пунктов для локали `en`.
 *
 * Текст самой причины формирует проверка (журнал §24.3): он приходит в `AiCheckResult.reasons` и
 * здесь только раскладывается по категориям. Требования к тексту — `ai-check-criteria.md` §5:
 * на языке версии, по существу, без порогов и внутренних признаков.
 */

import type { Locale } from "../generated/prisma"
import type { AiCheckReason, AiCheckReasonCategory } from "./types"

type CategoryTitles = Readonly<Record<AiCheckReasonCategory, string>>

const TITLES: Readonly<Record<Locale, CategoryTitles>> = {
  ru: {
    rights: "Нарушение прав на текст или изображения",
    illegal: "Незаконный контент",
    spam_ads: "Спам и реклама",
    third_party_pd: "Персональные данные третьих лиц",
    age: "Недопустимый по возрасту контент",
    topic_rules: "Несоответствие теме и правилам журнала"
  },
  en: {
    rights: "Rights to the text or images are violated",
    illegal: "Unlawful content",
    spam_ads: "Spam and advertising",
    third_party_pd: "Personal data of third parties",
    age: "Content not allowed for the stated age",
    topic_rules: "Does not match the topic or the magazine rules"
  }
}

export function aiCheckCategoryTitle(category: AiCheckReasonCategory, locale: Locale): string {
  return TITLES[locale][category]
}

const INTRO: Readonly<Record<Locale, string>> = {
  ru: "Проверка не допустила подачу к публикации. Причины по категориям правил публикации:",
  en: "The check did not clear this submission for publication. Reasons by content rule category:"
}

/**
 * Комментарий в историю решений при отказе: вступление и по одной строке на категорию.
 * Порядок причин сохраняется — одна подача может нарушать несколько категорий
 * (`ai-check-criteria.md` §3 п. 4).
 */
export function renderAiDecisionComment(reasons: readonly AiCheckReason[], locale: Locale): string {
  const lines = reasons.map((reason) => `— ${aiCheckCategoryTitle(reason.category, locale)}: ${reason.text}`)
  return [INTRO[locale], ...lines].join("\n")
}
