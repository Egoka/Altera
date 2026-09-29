import { describe, expect, it, vi } from "vitest"
import reviewHistoryResolver from "../src/graphql/review-history/resolver"

const now = new Date("2026-09-29T09:00:00.000Z")

const translation = {
  id: "translation-1",
  title: "Как устроен свет",
  locale: "ru",
  status: "rework",
  rejected: false,
  article: { authorId: "author-1" },
  reviewMessages: [
    {
      id: "decision-1",
      translationId: "translation-1",
      kind: "rework_request",
      text: "Нужна фактическая опора",
      recommendations: "Добавьте источник",
      byRole: "moderator",
      parentId: null,
      readAt: null,
      createdAt: new Date("2026-09-29T08:00:00.000Z"),
      replies: [
        {
          id: "reply-1",
          translationId: "translation-1",
          kind: "author_reply",
          text: "Источник добавлен",
          recommendations: null,
          byRole: "author",
          parentId: "decision-1",
          readAt: null,
          createdAt: new Date("2026-09-29T08:30:00.000Z")
        }
      ]
    }
  ],
  revisions: [
    {
      id: "revision-1",
      reviewNotes: [
        {
          id: "note-1",
          blockId: "block-1",
          text: "Уточните источник даты",
          resolved: false,
          createdAt: new Date("2026-09-29T08:05:00.000Z")
        }
      ]
    }
  ]
}

const createContext = (overrides: Record<string, unknown> = {}) => {
  const messages = structuredClone(translation.reviewMessages)
  return {
    currentUser: {
      id: "author-1",
      role: "author",
      archivedAt: null,
      planTier: "standard",
      planUntil: new Date("2099-01-01T00:00:00.000Z")
    },
    requestId: "req-review-history",
    requestMeta: { ip: "127.0.0.1" },
    logger: { log: vi.fn() },
    rateLimiter: { enforce: vi.fn(async () => ({ remaining: 59 })) },
    prisma: {
      articleTranslation: {
        findUnique: vi.fn(async () => ({ ...translation, reviewMessages: messages }))
      },
      aiProcess: {
        findFirst: vi.fn(async () => ({
          verdict: "reject",
          reasons: [{ category: "rights", anchor: "block-1", text: "Не указан источник изображения" }],
          finishedAt: new Date("2026-09-29T07:55:00.000Z")
        }))
      },
      reviewMessage: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === "decision-1"
            ? {
                ...translation.reviewMessages[0],
                translation: {
                  id: translation.id,
                  status: translation.status,
                  rejected: translation.rejected,
                  article: translation.article
                }
              }
            : null
        ),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "reply-2",
          ...data,
          createdAt: now
        })),
        updateMany: vi.fn(async () => ({ count: 1 }))
      },
      reviewNote: {
        findUnique: vi.fn(async () => ({
          ...translation.revisions[0]!.reviewNotes[0],
          revision: { translation: { status: "rework", article: translation.article } }
        })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...translation.revisions[0]!.reviewNotes[0],
          ...data,
          updatedAt: now
        }))
      }
    },
    ...overrides
  }
}

describe("review history author contract", () => {
  it("returns categorized AI reasons, the decision thread and block notes only to the author", async () => {
    const context = createContext()
    const result = await reviewHistoryResolver.Query.translationReview({}, { id: "translation-1" }, context as never)

    expect(result).toMatchObject({
      translationId: "translation-1",
      title: "Как устроен свет",
      status: "rework",
      readOnly: false,
      planLimited: false,
      aiDecision: {
        decision: "reject",
        reasons: [{ category: "rights", anchor: "block-1", text: "Не указан источник изображения" }]
      },
      items: [
        {
          id: "decision-1",
          kind: "rework_request",
          canReply: true,
          thread: [{ id: "reply-1", author: true, text: "Источник добавлен" }]
        }
      ],
      notes: [{ id: "note-1", blockId: "block-1", resolved: false }]
    })
    expect(context.prisma.aiProcess.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ objectType: "ArticleTranslation" }) })
    )
  })

  it("does not reveal another author's translation", async () => {
    const context = createContext({
      currentUser: {
        id: "author-2",
        role: "author",
        archivedAt: null,
        planTier: "standard",
        planUntil: new Date("2099-01-01T00:00:00.000Z")
      }
    })

    await expect(
      reviewHistoryResolver.Query.translationReview({}, { id: "translation-1" }, context as never)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } })
  })

  it("stores an author reply under the open decision and applies the cabinet mutation limit", async () => {
    const context = createContext()

    const reply = await reviewHistoryResolver.Mutation.replyToDecision(
      {},
      { decisionId: "decision-1", text: "  Источник добавлен  " },
      context as never
    )

    expect(reply).toMatchObject({
      id: "reply-2",
      author: true,
      text: "Источник добавлен",
      createdAt: now.toISOString()
    })
    expect(context.prisma.reviewMessage.create).toHaveBeenCalledWith({
      data: {
        translationId: "translation-1",
        kind: "author_reply",
        text: "Источник добавлен",
        byRole: "author",
        parentId: "decision-1"
      }
    })
    expect(context.rateLimiter.enforce).toHaveBeenCalledWith("account.mutation.user", "author-1", {
      requestId: "req-review-history",
      ip: "127.0.0.1"
    })
    expect(context.logger.log).toHaveBeenCalledWith({
      level: "info",
      event: "review.reply",
      requestId: "req-review-history",
      message: "Author replied to a review decision",
      data: { translationId: "translation-1", decisionId: "decision-1", byRole: "author" }
    })
  })

  it("keeps a final rejection thread closed", async () => {
    const context = createContext()
    context.prisma.reviewMessage.findUnique.mockResolvedValueOnce({
      ...translation.reviewMessages[0],
      kind: "final_reject",
      translation: { id: translation.id, status: "review", rejected: true, article: translation.article }
    })

    await expect(
      reviewHistoryResolver.Mutation.replyToDecision(
        {},
        { decisionId: "decision-1", text: "Прошу уточнить" },
        context as never
      )
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT", actual: "closed" } })
  })

  it("keeps an expired-plan history readable but blocks replies and note resolution", async () => {
    const context = createContext({
      currentUser: {
        id: "author-1",
        role: "reader",
        archivedAt: null,
        planTier: "free",
        planUntil: null
      }
    })

    const history = await reviewHistoryResolver.Query.translationReview({}, { id: "translation-1" }, context as never)
    expect(history).toMatchObject({ readOnly: true, planLimited: true, items: [{ canReply: false }] })

    await expect(
      reviewHistoryResolver.Mutation.replyToDecision(
        {},
        { decisionId: "decision-1", text: "Исправление готово" },
        context as never
      )
    ).rejects.toMatchObject({ extensions: { code: "PLAN_LIMIT" } })
    await expect(
      reviewHistoryResolver.Mutation.resolveReviewNote({}, { noteId: "note-1" }, context as never)
    ).rejects.toMatchObject({ extensions: { code: "PLAN_LIMIT" } })
  })

  it("marks an own block note resolved while the version is in rework", async () => {
    const context = createContext()

    const note = await reviewHistoryResolver.Mutation.resolveReviewNote({}, { noteId: "note-1" }, context as never)

    expect(note).toMatchObject({ id: "note-1", resolved: true })
    expect(context.prisma.reviewNote.update).toHaveBeenCalledWith({ where: { id: "note-1" }, data: { resolved: true } })
  })
})
