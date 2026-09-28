import { describe, expect, it, vi } from "vitest"
import mediaResolver from "../src/graphql/media/resolver"
import type { MediaAssetRecord, MediaService, MediaTranslationOwner } from "../src/media"
import type { GraphQLContext } from "../src/prisma"
import { createTestRateLimiter } from "./helpers/rate-limit"

// Права и лимит частоты у точки входа `uploadMedia` (`upload-pipeline.md` п. 1–2, 4; матрица #39).

const OWN_TRANSLATION = "translation-own"
const OTHER_TRANSLATION = "translation-other"
const EDITORIAL_TRANSLATION = "translation-editorial"

const translations: Record<string, MediaTranslationOwner> = {
  [OWN_TRANSLATION]: { translationId: OWN_TRANSLATION, authorId: "author-1", isEditorial: false },
  [OTHER_TRANSLATION]: { translationId: OTHER_TRANSLATION, authorId: "author-2", isEditorial: false },
  [EDITORIAL_TRANSLATION]: { translationId: EDITORIAL_TRANSLATION, authorId: "author-2", isEditorial: true }
}

const asset: MediaAssetRecord = {
  id: "asset-1",
  ownerId: "author-1",
  processingStatus: "queued",
  storageKey: "quarantine/00000000-0000-4000-8000-000000000001.upload",
  mimeType: "image/jpeg",
  byteSize: 2048,
  width: null,
  height: null,
  sha256: "checksum",
  attribution: "Иван Петров",
  license: "own",
  licenseNote: null,
  alt: null,
  caption: null,
  variants: [],
  deletedAt: null,
  createdAt: new Date("2026-09-28T10:00:00.000Z")
}

interface ContextOverrides {
  role?: string
  userId?: string
  planTier?: string
  planUntil?: Date | null
  currentUser?: null
  uploadEnabled?: boolean
}

const file = { size: 2048, arrayBuffer: async () => new ArrayBuffer(2048) }

const createContext = (overrides: ContextOverrides = {}) => {
  const upload = vi.fn(async () => asset)
  const media = {
    uploadEnabled: overrides.uploadEnabled ?? true,
    translations: {
      findTranslationOwner: vi.fn(async (id: string) => translations[id] ?? null)
    },
    upload
  } as unknown as MediaService

  const ctx = {
    currentUser:
      overrides.currentUser === null
        ? null
        : {
            id: overrides.userId ?? "author-1",
            role: overrides.role ?? "author",
            archivedAt: null,
            planTier: overrides.planTier ?? "standard",
            planUntil: overrides.planUntil ?? null,
            permissionExceptions: []
          },
    requestId: "req-media",
    requestMeta: { ip: "203.0.113.10", userAgent: null },
    logger: { log: vi.fn(), metric: vi.fn() },
    rateLimiter: createTestRateLimiter(),
    media
  } as unknown as GraphQLContext

  return { ctx, media, upload }
}

const uploadMedia = (ctx: GraphQLContext, translationId = OWN_TRANSLATION) =>
  mediaResolver.Mutation.uploadMedia({}, { translationId, file, license: "own", attribution: "Иван Петров" }, ctx)

const expectApiError = async (promise: Promise<unknown>, code: string, fields: Record<string, unknown> = {}) => {
  await expect(promise).rejects.toMatchObject({ extensions: { code, ...fields } })
}

describe("T-063 права загрузки медиа", () => {
  it("автор версии загружает медиа и получает запись с состоянием обработки", async () => {
    const { ctx, upload } = createContext()

    const result = await uploadMedia(ctx)

    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "author-1", license: "own", attribution: "Иван Петров" })
    )
    expect(result).toMatchObject({
      id: "asset-1",
      processingStatus: "queued",
      license: "own",
      createdAt: "2026-09-28T10:00:00.000Z"
    })
    // `alt` автор не задаёт: его создаёт конвейер (журнал §29.13).
    expect(result.alt).toBeNull()
  })

  it("гостю отвечает UNAUTHENTICATED", async () => {
    const { ctx } = createContext({ currentUser: null })

    await expectApiError(uploadMedia(ctx), "UNAUTHENTICATED")
  })

  it("закрытая загрузка отвечает FORBIDDEN до обращения к версии", async () => {
    const { ctx, media, upload } = createContext({ uploadEnabled: false })

    await expectApiError(uploadMedia(ctx), "FORBIDDEN", { action: "media.upload" })
    expect(media.translations.findTranslationOwner).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it("несуществующая версия отвечает NOT_FOUND", async () => {
    const { ctx } = createContext()

    await expectApiError(uploadMedia(ctx, "translation-missing"), "NOT_FOUND", { entity: "articleTranslation" })
  })

  it("чужая версия автору закрыта", async () => {
    const { ctx, upload } = createContext()

    await expectApiError(uploadMedia(ctx, OTHER_TRANSLATION), "FORBIDDEN", { action: "media.upload" })
    expect(upload).not.toHaveBeenCalled()
  })

  it("истёкший план автора даёт PLAN_LIMIT", async () => {
    const { ctx } = createContext({ planTier: "free" })

    await expectApiError(uploadMedia(ctx), "PLAN_LIMIT", { requiredTier: "standard" })
  })

  it("редакционный материал открыт сотруднику с правом editorial", async () => {
    const { ctx, upload } = createContext({ role: "editor", userId: "editor-1" })

    await expect(uploadMedia(ctx, EDITORIAL_TRANSLATION)).resolves.toMatchObject({ id: "asset-1" })
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "editor-1" }))
  })

  it("чужой авторский материал сотруднику закрыт: право editorial даёт только редакционные", async () => {
    const { ctx } = createContext({ role: "editor", userId: "editor-1" })

    await expectApiError(uploadMedia(ctx, OTHER_TRANSLATION), "FORBIDDEN", { action: "media.upload" })
  })

  it("роль без права editorial редакционный материал не загружает", async () => {
    const { ctx } = createContext({ role: "analyst", userId: "analyst-1" })

    await expectApiError(uploadMedia(ctx, EDITORIAL_TRANSLATION), "FORBIDDEN", { action: "media.upload" })
  })

  it("31-я загрузка в час отвечает RATE_LIMITED", async () => {
    const { ctx } = createContext()

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await expect(uploadMedia(ctx)).resolves.toMatchObject({ id: "asset-1" })
    }

    await expectApiError(uploadMedia(ctx), "RATE_LIMITED")
  })

  it("файл без байтов отвечает VALIDATION_ERROR", async () => {
    const { ctx } = createContext()

    await expectApiError(
      mediaResolver.Mutation.uploadMedia(
        {},
        { translationId: OWN_TRANSLATION, file: null, license: "own", attribution: "Иван Петров" },
        ctx
      ),
      "VALIDATION_ERROR",
      { field: "file", rule: "required" }
    )
  })
})
