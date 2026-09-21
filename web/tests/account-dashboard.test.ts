import { describe, expect, it } from "vitest"
import type { DashboardArticleFieldsFragment } from "~/graphql/generated/graphql"
import { selectAttention } from "~/utils/accountDashboard"

// Зона «Требует внимания» сводки кабинета (`docs/spec/30-account/reader/dashboard.md` §5 п. 4).

const NOW = new Date("2026-09-21T12:00:00.000Z").getTime()

type Translation = DashboardArticleFieldsFragment["translations"][number]

const article = (
  id: string,
  translation: Partial<Translation> = {},
  status = "draft"
): DashboardArticleFieldsFragment =>
  ({
    id,
    status,
    archivedBy: null,
    section: null,
    format: null,
    tags: [],
    translations: [
      {
        id: `${id}-ru`,
        locale: "ru",
        slug: id,
        title: id,
        status: "draft",
        rejected: false,
        publishedAt: null,
        updatedAt: "2026-09-21T11:00:00.000Z",
        reeditUntil: null,
        lastReviewMessageAt: null,
        unread: false,
        ...translation
      }
    ]
  }) as DashboardArticleFieldsFragment

describe("selectAttention", () => {
  it("keeps materials under check, unread rejections and an open re-edit window", () => {
    const items = selectAttention(
      [
        article("checking", { status: "ai_check" }),
        article("review", { status: "review" }),
        article("rejected", { status: "review", rejected: true, unread: true }),
        article("reedit", { status: "published", reeditUntil: "2026-09-21T12:30:00.000Z" })
      ],
      NOW
    )

    expect(items.map((item) => [item.article.id, item.reason])).toEqual([
      ["checking", "checking"],
      ["review", "checking"],
      ["rejected", "rejected"],
      ["reedit", "reedit"]
    ])
  })

  it("drops drafts, read rejections, closed windows and archived materials", () => {
    const items = selectAttention(
      [
        article("draft"),
        article("read-rejection", { status: "review", rejected: true, unread: false }),
        article("closed", { status: "published", reeditUntil: "2026-09-21T11:59:00.000Z" }),
        article("published", { status: "published" }),
        article("archived", { status: "review" }, "archived")
      ],
      NOW
    )

    expect(items).toEqual([])
  })
})
