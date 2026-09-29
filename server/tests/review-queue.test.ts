import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import {
  claimReview,
  createReviewNote,
  decideProfileCheck,
  listProfileReviewQueue,
  listReviewQueue,
  publishReviewManual,
  rejectReviewFinal,
  releaseReview,
  replyInReviewDecision,
  requestReviewRework,
  unpublishReview
} from "../src/review/queue"

const now = new Date("2026-09-29T12:00:00.000Z")

const actor = (role: "moderator" | "admin" | "owner", id = `${role}-1`) => ({
  id,
  role,
  archivedAt: null,
  isServiceAccount: true,
  planTier: "free",
  planUntil: null,
  permissionExceptions: []
})

const baseTranslation = () => ({
  id: "translation-1",
  articleId: "article-1",
  locale: "ru",
  slug: "light",
  title: "Как устроен свет",
  body: { type: "doc", content: [{ type: "paragraph", attrs: { id: "block-1" }, content: [] }] },
  status: "review",
  rejected: false,
  publishedAt: null as Date | null,
  reviewerId: null as string | null,
  reviewClaimedAt: null as Date | null,
  readCount: 37,
  createdAt: new Date("2026-09-28T08:00:00.000Z"),
  updatedAt: new Date("2026-09-29T08:00:00.000Z"),
  article: {
    id: "article-1",
    slug: "light",
    sourceLocale: "ru",
    isEditorial: false,
    firstPublishedAt: null as Date | null,
    sectionId: "section-1",
    coverAssetId: "cover-1",
    section: { slug: "science", status: "active", name: "Наука" },
    coverAsset: { id: "cover-1", processingStatus: "ready" },
    author: {
      id: "author-1",
      name: "Вера Орлова",
      handle: "vera",
      email: "private@example.test",
      locale: "ru",
      nameCheckStatus: "ok",
      avatarCheckStatus: "ok"
    },
    tags: [{ slug: "physics" }]
  },
  revisions: [
    {
      id: "revision-1",
      translationId: "translation-1",
      title: "Как устроен свет",
      body: { type: "doc", content: [{ type: "paragraph", attrs: { id: "block-1" }, content: [] }] },
      createdAt: new Date("2026-09-29T07:00:00.000Z"),
      reviewNotes: []
    }
  ],
  reviewMessages: []
})

const errorExtensions = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(GraphQLError)
    return (error as GraphQLError).extensions
  }
  throw new Error("Expected rejection")
}

const createHarness = (input: { role?: "moderator" | "admin" | "owner"; reviewerId?: string | null } = {}) => {
  const translation = baseTranslation()
  translation.reviewerId = input.reviewerId ?? null
  translation.status = input.reviewerId ? "in_review" : "review"
  const messages: Array<Record<string, unknown>> = []
  const notes: Array<Record<string, unknown>> = []
  const audits: Array<Record<string, unknown>> = []
  const profile = {
    id: "profile-1",
    name: "Старая подпись",
    pendingName: "Новая подпись",
    handle: "profile-one",
    avatarAssetId: "avatar-new",
    prevAvatarId: "avatar-old",
    avatarAsset: null,
    previousAvatar: null,
    nameCheckStatus: "pending",
    avatarCheckStatus: "pending",
    createdAt: new Date("2026-09-28T10:00:00.000Z"),
    updatedAt: new Date("2026-09-29T09:00:00.000Z")
  }

  const matchesTranslationWhere = (where: Record<string, unknown>) => {
    if (where.id && where.id !== translation.id) return false
    if (where.status) {
      if (typeof where.status === "string" && where.status !== translation.status) return false
      if (typeof where.status === "object" && where.status && "in" in where.status) {
        if (!(where.status.in as string[]).includes(translation.status)) return false
      }
    }
    if ("reviewerId" in where && where.reviewerId !== translation.reviewerId) return false
    if ("rejected" in where && where.rejected !== translation.rejected) return false
    return true
  }

  const prisma: Record<string, unknown> = {}
  Object.assign(prisma, {
    articleTranslation: {
      findMany: vi.fn(async () => [structuredClone(translation)]),
      count: vi.fn(async () => 1),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === translation.id ? structuredClone(translation) : null
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!matchesTranslationWhere(where)) return { count: 0 }
        Object.assign(translation, data)
        translation.updatedAt = now
        return { count: 1 }
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(translation, data)
        translation.updatedAt = now
        return structuredClone(translation)
      })
    },
    article: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(translation.article, data)
        return structuredClone(translation.article)
      })
    },
    reviewMessage: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = messages.find(({ id }) => id === where.id)
        return found ? { ...found, translation: structuredClone(translation) } : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const message = { id: `message-${messages.length + 1}`, createdAt: now, ...data }
        messages.push(message)
        return message
      })
    },
    aiProcess: {
      findFirst: vi.fn(async () => null)
    },
    reviewNote: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const note = { id: `note-${notes.length + 1}`, resolved: false, createdAt: now, updatedAt: now, ...data }
        notes.push(note)
        return note
      })
    },
    articleRevision: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "revision-1" ? { ...translation.revisions[0], translation: structuredClone(translation) } : null
      )
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data)
        return { id: `audit-${audits.length}`, createdAt: now, ...data }
      })
    },
    user: {
      findMany: vi.fn(async () => [structuredClone(profile)]),
      count: vi.fn(async () => 1),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === profile.id ? structuredClone(profile) : null
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.id !== profile.id) return { count: 0 }
        const field = "nameCheckStatus" in where ? "nameCheckStatus" : "avatarCheckStatus"
        if (where[field] !== profile[field]) return { count: 0 }
        Object.assign(profile, data)
        return { count: 1 }
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(profile, data)
        return structuredClone(profile)
      })
    },
    mediaAsset: { updateMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(prisma))
  })

  const cache = { delByTags: vi.fn(async () => undefined) }
  const logger = { log: vi.fn(), metric: vi.fn() }
  const sentMail: Array<Record<string, unknown>> = []
  const mail = {
    send: vi.fn(async (input: Record<string, unknown>) => {
      sentMail.push(input)
      return { mailId: "mail-1", messageId: "message-1" }
    })
  }
  const currentUser = actor(input.role ?? "moderator")
  const ctx = {
    prisma,
    currentUser,
    requestId: "req-review",
    cache,
    logger,
    mail,
    media: { mediaBaseUrl: "https://media.test" }
  }
  return { ctx, translation, profile, messages, notes, audits, cache, logger, sentMail }
}

describe("review queue", () => {
  it("returns the exact stored read count and public author identity without e-mail to admin", async () => {
    const { ctx } = createHarness({ role: "admin" })

    const page = await listReviewQueue(ctx as never, { pagination: { page: 1, limit: 20 } })

    expect(page.items[0]).toMatchObject({
      id: "translation-1",
      state: "queued",
      readCount: 37,
      author: { name: "Вера Орлова", handle: "vera" }
    })
    expect(page.items[0]?.author).not.toHaveProperty("email")
    expect(page.pagination).toMatchObject({ currentPage: 1, totalItems: 1, itemsPerPage: 20 })
  })

  it("combines section and editorial filters on the same article predicate", async () => {
    const { ctx } = createHarness({ role: "admin" })

    await listReviewQueue(ctx as never, { filters: { sectionId: "section-1", editorial: false } })

    expect(ctx.prisma.articleTranslation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ article: { sectionId: "section-1", isEditorial: false } })
      })
    )
  })

  it("can list published materials so unpublish is reachable from the review workspace", async () => {
    const harness = createHarness({ role: "admin" })
    harness.translation.status = "published"
    harness.translation.publishedAt = now

    const page = await listReviewQueue(harness.ctx as never, { filters: { states: ["published"] } })

    expect(page.items[0]).toMatchObject({ state: "published", status: "published" })
  })

  it("lets one moderator claim a queued item and rejects another moderator's decision", async () => {
    const first = createHarness()
    const claimed = await claimReview(first.ctx as never, "translation-1", now)
    expect(claimed).toMatchObject({ state: "in_review", reviewer: { role: "moderator", mine: true } })

    const second = createHarness({ reviewerId: "moderator-1" })
    second.ctx.currentUser = actor("moderator", "moderator-2")
    const extensions = await errorExtensions(
      requestReviewRework(second.ctx as never, "translation-1", "Добавьте источник", now)
    )
    expect(extensions).toMatchObject({ code: "CONFLICT", entity: "translation", actual: "claimed_by_other" })
    expect(second.messages).toHaveLength(0)
  })

  it("requires recommendations, moves the item to rework, releases the claim and records #24/#70", async () => {
    const harness = createHarness({ reviewerId: "moderator-1" })

    expect(await errorExtensions(requestReviewRework(harness.ctx as never, "translation-1", "   ", now))).toMatchObject(
      { code: "VALIDATION_ERROR", field: "recommendations", rule: "required" }
    )

    const item = await requestReviewRework(harness.ctx as never, "translation-1", "  Добавьте источник  ", now)
    expect(item).toMatchObject({ state: "rework", reviewer: null })
    expect(harness.messages).toContainEqual(
      expect.objectContaining({ kind: "rework_request", recommendations: "Добавьте источник", byRole: "moderator" })
    )
    expect(harness.audits.map(({ action }) => action).sort()).toEqual(
      ["translation.rework.request", "review.message"].sort()
    )
  })

  it("publishes a complete claimed item immediately, writes audit events and invalidates public caches", async () => {
    const harness = createHarness({ reviewerId: "moderator-1" })
    const item = await publishReviewManual(harness.ctx as never, "translation-1", "Проверено вручную", now)

    expect(item).toMatchObject({ status: "published", state: "published", publishedAt: now })
    expect(harness.translation.article).toMatchObject({ firstPublishedAt: now })
    expect(harness.audits.map(({ action }) => action).sort()).toEqual(
      ["translation.publish.manual", "review.message"].sort()
    )
    expect(harness.cache.delByTags).toHaveBeenCalledWith(
      expect.arrayContaining(["home", "article:light", "author:vera"])
    )
    expect(harness.logger.metric).toHaveBeenCalledWith(expect.objectContaining({ event: "translation.published" }))
  })

  it("blocks manual publication when the author profile is incomplete without changing visibility", async () => {
    const harness = createHarness({ reviewerId: "moderator-1" })
    harness.translation.article.author.name = ""

    const extensions = await errorExtensions(publishReviewManual(harness.ctx as never, "translation-1", null, now))
    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field: "profile", rule: "required" })
    expect(harness.translation.status).toBe("in_review")
    expect(harness.messages).toHaveLength(0)
  })

  it("supports final rejection, release and unpublish with atomic state checks", async () => {
    const rejected = createHarness({ reviewerId: "moderator-1" })
    const finalItem = await rejectReviewFinal(rejected.ctx as never, "translation-1", "Нарушает правила", now)
    expect(finalItem).toMatchObject({ rejected: true, state: null })
    expect(rejected.messages).toContainEqual(
      expect.objectContaining({ kind: "final_reject", text: "Нарушает правила" })
    )
    expect(rejected.audits.map(({ action }) => action).sort()).toEqual(
      ["translation.reject.final", "review.message"].sort()
    )

    const released = createHarness({ reviewerId: "moderator-1" })
    expect(await releaseReview(released.ctx as never, "translation-1", now)).toMatchObject({ state: "queued" })

    const unpublished = createHarness({ reviewerId: "moderator-1" })
    unpublished.translation.status = "published"
    unpublished.translation.publishedAt = new Date("2026-09-20T00:00:00.000Z")
    unpublished.translation.article.firstPublishedAt = unpublished.translation.publishedAt
    unpublished.translation.reviewerId = null
    const item = await unpublishReview(unpublished.ctx as never, "translation-1", "Нужна проверка источников", now)
    expect(item).toMatchObject({ status: "review", state: "queued", publishedAt: null })
    expect(unpublished.messages).toContainEqual(
      expect.objectContaining({ kind: "unpublish", text: "Нужна проверка источников" })
    )
    expect(unpublished.audits.map(({ action }) => action).sort()).toEqual(
      ["translation.unpublish", "review.message"].sort()
    )
  })

  it("keeps reviewer replies and block notes attached to the selected decision and revision", async () => {
    const harness = createHarness({ reviewerId: "moderator-1" })
    harness.messages.push({
      id: "decision-1",
      translationId: "translation-1",
      kind: "rework_request",
      parentId: null,
      byRole: "moderator",
      createdAt: now
    })

    const reply = await replyInReviewDecision(harness.ctx as never, "decision-1", "  Уточните подпись  ")
    const note = await createReviewNote(harness.ctx as never, {
      translationId: "translation-1",
      revisionId: "revision-1",
      blockId: "block-1",
      text: "  Нужна ссылка  "
    })

    expect(reply).toMatchObject({ kind: "message", parentId: "decision-1", text: "Уточните подпись" })
    expect(note).toMatchObject({ revisionId: "revision-1", blockId: "block-1", text: "Нужна ссылка" })
    expect(harness.audits.map(({ action }) => action)).toEqual(["review.message", "review.message"])
  })
})

describe("profile review queue", () => {
  it("returns pending name/avatar checks without e-mail and resolves them with profile.check audit", async () => {
    const harness = createHarness()

    const page = await listProfileReviewQueue(harness.ctx as never, { pagination: { page: 1, limit: 20 } })
    expect(page.items).toEqual([
      expect.objectContaining({
        userId: "profile-1",
        name: "Новая подпись",
        previousName: "Старая подпись",
        handle: "profile-one",
        fields: ["name", "avatar"]
      })
    ])
    expect(page.items[0]).not.toHaveProperty("email")
    expect(harness.profile.name).toBe("Старая подпись")

    const result = await decideProfileCheck(
      harness.ctx as never,
      { userId: "profile-1", field: "name", verdict: "accept", reason: null },
      now
    )
    expect(result).toMatchObject({
      userId: "profile-1",
      name: "Новая подпись",
      previousName: "Новая подпись",
      nameStatus: "ok",
      avatarStatus: "pending"
    })
    expect(harness.audits).toContainEqual(
      expect.objectContaining({ action: "profile.check", entityType: "user", entityId: "profile-1" })
    )
  })

  it("keeps the public name on rejection and refuses an avatar rejection without a previous version", async () => {
    const nameHarness = createHarness()
    const rejected = await decideProfileCheck(
      nameHarness.ctx as never,
      { userId: "profile-1", field: "name", verdict: "reject", reason: "Не соответствует правилам" },
      now
    )
    expect(rejected).toMatchObject({ name: "Старая подпись", previousName: "Старая подпись", nameStatus: "rejected" })
    expect(nameHarness.profile).toMatchObject({ name: "Старая подпись", pendingName: null })

    const avatarHarness = createHarness()
    avatarHarness.profile.prevAvatarId = null
    const extensions = await errorExtensions(
      decideProfileCheck(
        avatarHarness.ctx as never,
        { userId: "profile-1", field: "avatar", verdict: "reject", reason: null },
        now
      )
    )
    expect(extensions).toMatchObject({
      code: "CONFLICT",
      entity: "avatar",
      expected: "previousVersion",
      actual: "none"
    })
    expect(avatarHarness.profile.avatarAssetId).toBe("avatar-new")
  })
})
