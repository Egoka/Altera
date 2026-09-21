import type { DashboardArticleFieldsFragment } from "~/graphql/generated/graphql"

export type AttentionReason = "checking" | "rejected" | "reedit"

export interface AttentionItem {
  article: DashboardArticleFieldsFragment
  translation: DashboardArticleFieldsFragment["translations"][number]
  reason: AttentionReason
}

/**
 * Зона «Требует внимания» (`docs/spec/30-account/reader/dashboard.md` §5 п. 4): материал на
 * проверке, отклонённый с непрочитанным объяснением и открытое окно «перередактировать».
 * Проверяется каждая языковая версия; архивированный материал внимания не требует.
 */
export function selectAttention(articles: readonly DashboardArticleFieldsFragment[], now: number): AttentionItem[] {
  const items: AttentionItem[] = []

  for (const article of articles) {
    if (article.status === "archived") continue

    for (const translation of article.translations) {
      if (translation.rejected) {
        if (translation.unread) items.push({ article, translation, reason: "rejected" })
        continue
      }

      if (translation.status === "ai_check" || translation.status === "review" || translation.status === "in_review") {
        items.push({ article, translation, reason: "checking" })
        continue
      }

      if (
        translation.status === "published" &&
        translation.reeditUntil &&
        new Date(translation.reeditUntil).getTime() > now
      ) {
        items.push({ article, translation, reason: "reedit" })
      }
    }
  }

  return items
}
