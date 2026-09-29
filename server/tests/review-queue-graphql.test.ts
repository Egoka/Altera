import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import { buildASTSchema, isObjectType, validateSchema } from "graphql"
import path from "path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  claimReview,
  createReviewNote,
  decideProfileCheck,
  getReviewItem,
  listProfileReviewQueue,
  listReviewQueue,
  publishReviewManual,
  rejectReviewFinal,
  releaseReview,
  replyInReviewDecision,
  requestReviewRework,
  unpublishReview
} from "../src/review/queue"
import resolver from "../src/graphql/review-queue/resolver"

vi.mock("../src/review/queue", () => ({
  claimReview: vi.fn(),
  createReviewNote: vi.fn(),
  decideProfileCheck: vi.fn(),
  getReviewItem: vi.fn(),
  listProfileReviewQueue: vi.fn(),
  listReviewQueue: vi.fn(),
  publishReviewManual: vi.fn(),
  rejectReviewFinal: vi.fn(),
  releaseReview: vi.fn(),
  replyInReviewDecision: vi.fn(),
  requestReviewRework: vi.fn(),
  unpublishReview: vi.fn()
}))

const context = { requestId: "req-review-graphql" }
const date = new Date("2026-09-29T12:00:00.000Z")

const queueItem = {
  id: "translation-1",
  articleId: "article-1",
  title: "Как устроен свет",
  slug: "light",
  locale: "ru",
  status: "review",
  state: "queued",
  rejected: false,
  publishedAt: null,
  readCount: 37,
  createdAt: date,
  updatedAt: date,
  author: { id: "author-1", name: "Вера Орлова", handle: "vera", email: "must-not-leak@example.test" },
  section: { slug: "science", name: "Наука" },
  editorial: false,
  reviewer: null
}

describe("review queue GraphQL contract", () => {
  beforeEach(() => vi.clearAllMocks())

  it("exposes safe queue, item, decision, note and profile types without author e-mail", () => {
    const typeDefs = loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] })
    const schema = buildASTSchema(mergeTypeDefs(typeDefs))

    expect(validateSchema(schema)).toEqual([])
    expect(schema.getQueryType()?.getFields()).toMatchObject({
      reviewQueue: expect.any(Object),
      reviewItem: expect.any(Object),
      profileReviewQueue: expect.any(Object)
    })
    expect(schema.getMutationType()?.getFields()).toMatchObject({
      claimReview: expect.any(Object),
      requestReviewRework: expect.any(Object),
      publishReviewManual: expect.any(Object),
      rejectReviewFinal: expect.any(Object),
      unpublishReview: expect.any(Object),
      replyInReviewDecision: expect.any(Object),
      createReviewNote: expect.any(Object),
      decideProfileCheck: expect.any(Object)
    })

    const author = schema.getType("AdminReviewAuthor")
    expect(isObjectType(author)).toBe(true)
    if (isObjectType(author)) expect(Object.keys(author.getFields()).sort()).toEqual(["handle", "id", "name"])
  })

  it("presents exact reads and ISO dates while stripping fields outside the safe author DTO", async () => {
    vi.mocked(listReviewQueue).mockResolvedValue({
      items: [queueItem as never],
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalItems: 1,
        itemsPerPage: 20,
        hasNextPage: false,
        hasPreviousPage: false
      }
    })

    const result = await resolver.Query.reviewQueue(
      null,
      { filters: { states: ["queued"] }, pagination: { page: 1, limit: 20 }, sort: "age" },
      context as never
    )

    expect(listReviewQueue).toHaveBeenCalledWith(context, {
      filters: { states: ["queued"] },
      pagination: { page: 1, limit: 20 },
      sort: "age"
    })
    expect(result.items[0]).toMatchObject({
      readCount: 37,
      createdAt: date.toISOString(),
      updatedAt: date.toISOString(),
      author: { id: "author-1", name: "Вера Орлова", handle: "vera" }
    })
    expect(result.items[0].author).not.toHaveProperty("email")
  })

  it("serializes item history, revision notes and AI decision dates", async () => {
    vi.mocked(getReviewItem).mockResolvedValue({
      ...queueItem,
      body: { type: "doc" },
      revisions: [
        {
          id: "revision-1",
          title: "Как устроен свет",
          body: { type: "doc" },
          createdAt: date,
          reviewNotes: [{ id: "note-1", blockId: "block-1", text: "Нужна ссылка", resolved: false, createdAt: date }]
        }
      ],
      decisions: [
        {
          id: "decision-1",
          kind: "rework_request",
          text: null,
          recommendations: "Добавьте источник",
          byRole: "moderator",
          createdAt: date,
          replies: [{ id: "reply-1", kind: "message", text: "Исправлено", byRole: "moderator", createdAt: date }]
        }
      ],
      aiDecision: { verdict: "rework", reasons: [{ category: "sources" }], finishedAt: date }
    } as never)

    const result = await resolver.Query.reviewItem(null, { id: "translation-1" }, context as never)

    expect(result.revisions[0]).toMatchObject({
      createdAt: date.toISOString(),
      notes: [{ createdAt: date.toISOString(), blockId: "block-1" }]
    })
    expect(result.decisions[0]).toMatchObject({
      createdAt: date.toISOString(),
      replies: [{ createdAt: date.toISOString(), text: "Исправлено" }]
    })
    expect(result.aiDecision?.finishedAt).toBe(date.toISOString())
  })

  it("maps every mutation to the reviewer service without adding policy", async () => {
    vi.mocked(claimReview).mockResolvedValue({
      ...queueItem,
      body: { type: "doc" },
      revisions: [],
      decisions: [],
      aiDecision: null
    } as never)
    vi.mocked(createReviewNote).mockResolvedValue({ id: "note-1", createdAt: date } as never)
    vi.mocked(decideProfileCheck).mockResolvedValue({ userId: "user-1", updatedAt: date } as never)
    vi.mocked(replyInReviewDecision).mockResolvedValue({ id: "reply-1", createdAt: date } as never)

    await resolver.Mutation.claimReview(null, { id: "translation-1" }, context as never)
    await resolver.Mutation.createReviewNote(
      null,
      { input: { translationId: "translation-1", revisionId: "revision-1", blockId: "block-1", text: "Note" } },
      context as never
    )
    await resolver.Mutation.decideProfileCheck(
      null,
      { input: { userId: "user-1", field: "name", verdict: "accept", reason: null } },
      context as never
    )
    await resolver.Mutation.replyInReviewDecision(null, { decisionId: "decision-1", text: "Reply" }, context as never)

    expect(claimReview).toHaveBeenCalledWith(context, "translation-1")
    expect(createReviewNote).toHaveBeenCalledWith(context, expect.objectContaining({ blockId: "block-1" }))
    expect(decideProfileCheck).toHaveBeenCalledWith(context, expect.objectContaining({ verdict: "accept" }))
    expect(replyInReviewDecision).toHaveBeenCalledWith(context, "decision-1", "Reply")

    expect(releaseReview).not.toHaveBeenCalled()
    expect(requestReviewRework).not.toHaveBeenCalled()
    expect(publishReviewManual).not.toHaveBeenCalled()
    expect(rejectReviewFinal).not.toHaveBeenCalled()
    expect(unpublishReview).not.toHaveBeenCalled()
    expect(listProfileReviewQueue).not.toHaveBeenCalled()
  })
})
