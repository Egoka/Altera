import type { DashboardArticleFieldsFragment } from "~/graphql/generated/graphql"

export type AttentionReason = "checking" | "rejected" | "reedit"

export interface AttentionItem {
  article: DashboardArticleFieldsFragment
  reason: AttentionReason
}

/**
 * Зона «Требует внимания» (`docs/spec/30-account/reader/dashboard.md` §5 п. 4): материал на
 * проверке, отклонённый с непрочитанным объяснением и открытое окно «перередактировать».
 * Архивированный материал внимания не требует.
 */
export function selectAttention(articles: readonly DashboardArticleFieldsFragment[], now: number): AttentionItem[] {
  const items: AttentionItem[] = []

  for (const article of articles) {
    const translation = article.translations[0]
    if (!translation || article.status === "archived") continue

    if (translation.rejected) {
      if (translation.unread) items.push({ article, reason: "rejected" })
      continue
    }

    if (translation.status === "ai_check" || translation.status === "review" || translation.status === "in_review") {
      items.push({ article, reason: "checking" })
      continue
    }

    if (
      translation.status === "published" &&
      translation.reeditUntil &&
      new Date(translation.reeditUntil).getTime() > now
    ) {
      items.push({ article, reason: "reedit" })
    }
  }

  return items
}
