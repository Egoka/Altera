import { beforeEach, describe, expect, it, vi } from "vitest"
import { removeAccountAvatar, revertAccountAvatar, uploadAccountAvatar } from "../src/account/avatar"
import type { Cache } from "../src/cache"
import avatarResolver from "../src/graphql/avatar/resolver"
import type { MediaAssetRecord } from "../src/media"
import type { GraphQLContext } from "../src/prisma"
import { createTestRateLimiter } from "./helpers/rate-limit"

// Аватар аккаунта T-065: применение сразу, предыдущая версия, откат рецензентом с записью
// журнала и удаление до инициалов (`avatars.md` п. 1, 4, 5, 8; журнал §29.5, §25.2; матрица #120).

const MEDIA_BASE = "https://media.altera.test"
const READY_VARIANTS = {
  version: 1,
  placeholder: "data:image/webp;base64,ZmFrZQ==",
  thumbnailWidth: 64,
  items: [
    {
      format: "webp",
      width: 256,
      height: 256,
      key: "2026/09/00000000-0000-4000-8000-000000000001/w256.webp",
      byteSize: 1024
    }
  ]
}

interface MemoryUser {
  id: string
  handle: string
  role: string
  avatarAssetId: string | null
  prevAvatarId: string | null
  avatarCheckStatus: string
  isServiceAccount: boolean
  archivedAt: Date | null
  planTier: string
  planUntil: Date | null
}

const memoryUser = (overrides: Partial<MemoryUser> & { id: string }): MemoryUser => ({
  handle: overrides.id,
  role: "author",
  avatarAssetId: null,
  prevAvatarId: null,
  avatarCheckStatus: "ok",
  isServiceAccount: false,
  archivedAt: null,
  planTier: "standard",
  planUntil: null,
  ...overrides
})

interface MemoryAsset {
  id: string
  processingStatus: string
  deletedAt: Date | null
  variants: unknown
}

class MemoryCache implements Cache {
  readonly mode = "noop" as const
  readonly dropped: string[] = []

  async isReady(): Promise<boolean> {
    return true
  }
  async get<T>(): Promise<T | null> {
    return null
  }
  async set(): Promise<void> {}
  async del(): Promise<void> {}
  async delByTags(tags: string[]): Promise<void> {
    this.dropped.push(...tags)
  }
  async close(): Promise<void> {}
}

/**
 * Двойник Prisma для одного модуля: только те операции, которые делает `account/avatar.ts` —
 * чтение и обновление аккаунта, мягкое удаление записи медиа, журнал аудита и транзакция.
 */
function createPrismaDouble(users: MemoryUser[], assets: MemoryAsset[]) {
  const auditLogs: Record<string, unknown>[] = []
  const find = (id: string) => users.find((user) => user.id === id) ?? null

  const client = {
    user: {
      // Prisma отдаёт снимок строки, а не саму запись: копия не даёт последующему обновлению
      // задним числом поменять то, что вызывающий уже прочитал.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const user = find(where.id)
        return user ? { ...user } : null
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const user = find(where.id)
        if (!user) throw new Error(`No user ${where.id}`)
        Object.assign(user, data)
        return user
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const user = find(where.id as string)
        const matches =
          user !== null &&
          (!("prevAvatarId" in where) || user.prevAvatarId === where.prevAvatarId) &&
          (!("avatarAssetId" in where) || user.avatarAssetId === where.avatarAssetId)
        if (!matches) return { count: 0 }
        Object.assign(user, data)
        return { count: 1 }
      })
    },
    mediaAsset: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => assets.find((asset) => asset.id === where.id) ?? null
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; deletedAt: null }; data: { deletedAt: Date } }) => {
          const asset = assets.find((item) => item.id === where.id && item.deletedAt === null)
          if (!asset) return { count: 0 }
          asset.deletedAt = data.deletedAt
          return { count: 1 }
        }
      )
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data)
        return data
      })
    },
    aiProcess: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data)
    },
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(client))
  }

  return { client, auditLogs, users, assets }
}

interface ContextOptions {
  actor?: Partial<MemoryUser> & { id: string }
  users?: MemoryUser[]
  assets?: MemoryAsset[]
  uploadEnabled?: boolean
  uploaded?: MediaAssetRecord
  currentUser?: null
  avatarVerdict?: "publish" | "reject"
}

const uploadedAsset = (id: string): MediaAssetRecord => ({
  id,
  ownerId: "author-1",
  processingStatus: "ready",
  storageKey: "2026/09/00000000-0000-4000-8000-000000000001.jpg",
  mimeType: "image/jpeg",
  byteSize: 4096,
  width: 512,
  height: 512,
  sha256: "checksum",
  attribution: "",
  license: "own",
  licenseNote: null,
  alt: null,
  caption: null,
  variants: READY_VARIANTS,
  deletedAt: null,
  createdAt: new Date("2026-09-28T10:00:00.000Z")
})

function createContext(options: ContextOptions = {}) {
  const actor = memoryUser(options.actor ?? { id: "author-1" })
  const users = options.users ?? [actor]
  if (!users.some((user) => user.id === actor.id)) users.push(actor)
  const assets = options.assets ?? []
  const double = createPrismaDouble(users, assets)
  const cache = new MemoryCache()
  const uploaded = options.uploaded ?? uploadedAsset("asset-new")
  const uploadAvatar = vi.fn(async () => uploaded)

  const ctx = {
    prisma: double.client,
    currentUser: options.currentUser === null ? null : actor,
    requestId: "request-1",
    requestMeta: { ip: "203.0.113.10", userAgent: null },
    cache,
    rateLimiter: createTestRateLimiter(),
    aiCheck: {
      model: "fake-check",
      promptVersion: "fake-1",
      check: vi.fn(async () => ({
        verdict: options.avatarVerdict ?? "publish",
        reasons: [],
        evidence: [],
        manipulationAttempt: false,
        adult: false,
        model: "fake-check",
        promptVersion: "fake-1",
        costMinor: 0
      }))
    },
    media: {
      uploadEnabled: options.uploadEnabled ?? true,
      mediaBaseUrl: MEDIA_BASE,
      uploadAvatar
    }
  } as unknown as GraphQLContext

  return { ctx, ...double, cache, uploadAvatar, actor, uploaded }
}

const file = { size: 4096, bytes: async () => Buffer.from("jpeg") }

describe("T-065 аватар аккаунта", () => {
  let now: Date

  beforeEach(() => {
    now = new Date("2026-09-28T12:00:00.000Z")
  })

  describe("критерий 1: применяется сразу и виден публично", () => {
    it("ставит новую запись текущим аватаром и отдаёт адрес варианта", async () => {
      const { ctx, actor, uploaded } = createContext()

      const view = await uploadAccountAvatar(ctx, { file })

      expect(actor.avatarAssetId).toBe(uploaded.id)
      expect(view?.assetId).toBe(uploaded.id)
      expect(view?.url).toBe(`${MEDIA_BASE}/${READY_VARIANTS.items[0]!.key}`)
      // Состояние проверки не мешает показу: автопроверка идёт следом (журнал §29.5).
      expect(actor.avatarCheckStatus).toBe("ok")
    })

    it("отправляет новую версию адаптеру T-048 и помечает подозрительную для ручной проверки", async () => {
      const { ctx, actor } = createContext({ avatarVerdict: "reject" })

      await uploadAccountAvatar(ctx, { file })

      expect(ctx.aiCheck.check).toHaveBeenCalledWith(
        expect.objectContaining({ translationId: "profile:author-1:avatar", images: [expect.any(Object)] })
      )
      expect(actor.avatarCheckStatus).toBe("pending")
    })

    it("не записывает результат проверки поверх более нового аватара", async () => {
      const { ctx, actor } = createContext()
      vi.mocked(ctx.aiCheck.check).mockImplementationOnce(async () => {
        actor.avatarAssetId = "asset-newer"
        return {
          verdict: "publish",
          reasons: [],
          evidence: [],
          manipulationAttempt: false,
          adult: false,
          model: "fake-check",
          promptVersion: "fake-1",
          costMinor: 0
        }
      })

      await expect(uploadAccountAvatar(ctx, { file })).rejects.toMatchObject({
        extensions: { code: "CONFLICT", entity: "avatar", actual: "changed" }
      })
      expect(actor.avatarAssetId).toBe("asset-newer")
    })

    it("сбрасывает кеш публичных страниц автора — иначе гость видел бы прежний аватар", async () => {
      const { ctx, cache } = createContext({ actor: { id: "author-1", handle: "vera" } })

      await uploadAccountAvatar(ctx, { file })

      expect(cache.dropped).toEqual(["author:vera", "home"])
    })

    it("прежняя версия становится предыдущей", async () => {
      const { ctx, actor, uploaded } = createContext({
        actor: { id: "author-1", avatarAssetId: "asset-old", prevAvatarId: "asset-older" }
      })

      await uploadAccountAvatar(ctx, { file })

      expect(actor.prevAvatarId).toBe("asset-old")
      expect(actor.avatarAssetId).toBe(uploaded.id)
    })

    it("передаёт кадр автора конвейеру", async () => {
      const { ctx, uploadAvatar } = createContext()

      await uploadAccountAvatar(ctx, { file, crop: { x: 10, y: 20, size: 300 } })

      expect(uploadAvatar).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: "author-1", crop: { x: 10, y: 20, size: 300 } })
      )
    })
  })

  describe("критерий 3: удаление и служебные записи", () => {
    it("удаление показывает инициалы: связей нет, запись помечена удалённой", async () => {
      const assets: MemoryAsset[] = [
        { id: "asset-old", processingStatus: "ready", deletedAt: null, variants: READY_VARIANTS }
      ]
      const { ctx, actor } = createContext({
        actor: { id: "author-1", avatarAssetId: "asset-old", prevAvatarId: "asset-older" },
        assets
      })

      expect(await removeAccountAvatar(ctx, now)).toBeNull()
      expect(actor.avatarAssetId).toBeNull()
      // Возвращать после удаления нечего: прежняя версия тоже отвязывается.
      expect(actor.prevAvatarId).toBeNull()
      expect(assets[0]!.deletedAt).toEqual(now)
    })

    it("повторное удаление без аватара ничего не меняет", async () => {
      const { ctx, client } = createContext()

      expect(await removeAccountAvatar(ctx, now)).toBeNull()
      expect(client.$transaction).not.toHaveBeenCalled()
    })

    it("служебная запись аватара не имеет — FORBIDDEN (журнал §25.2)", async () => {
      const { ctx } = createContext({ actor: { id: "staff-1", role: "moderator", isServiceAccount: true } })

      await expect(uploadAccountAvatar(ctx, { file })).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN", action: "profile.update" }
      })
      await expect(removeAccountAvatar(ctx, now)).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN", action: "profile.update" }
      })
    })

    it("ограниченная сессия архивированного аккаунта аватар не меняет", async () => {
      const { ctx } = createContext({ actor: { id: "author-1", archivedAt: new Date("2026-09-01T00:00:00.000Z") } })

      await expect(uploadAccountAvatar(ctx, { file })).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN" }
      })
    })

    it("гость получает UNAUTHENTICATED", async () => {
      const { ctx } = createContext({ currentUser: null })

      await expect(uploadAccountAvatar(ctx, { file })).rejects.toMatchObject({
        extensions: { code: "UNAUTHENTICATED" }
      })
    })
  })

  describe("критерий 2: откат рецензентом", () => {
    const withPrevious = () =>
      createContext({
        actor: { id: "moderator-1", role: "moderator" },
        users: [memoryUser({ id: "author-1", handle: "vera", avatarAssetId: "asset-new", prevAvatarId: "asset-old" })],
        assets: [{ id: "asset-old", processingStatus: "ready", deletedAt: null, variants: READY_VARIANTS }]
      })

    it("возвращает предыдущую версию и пишет profile.check с verdict reverted", async () => {
      const { ctx, auditLogs, users } = withPrevious()

      const view = await revertAccountAvatar(ctx, { userId: "author-1", reason: "Не подходит для профиля" })

      const target = users.find((user) => user.id === "author-1")!
      expect(target.avatarAssetId).toBe("asset-old")
      expect(target.prevAvatarId).toBeNull()
      expect(target.avatarCheckStatus).toBe("rejected")
      expect(view?.assetId).toBe("asset-old")

      expect(auditLogs).toHaveLength(1)
      expect(auditLogs[0]).toMatchObject({
        action: "profile.check",
        actorId: "moderator-1",
        actorRole: "moderator",
        entityType: "user",
        entityId: "author-1",
        diff: {
          userId: "author-1",
          field: "avatar",
          verdict: "reverted",
          byRole: "moderator",
          restoredAssetId: "asset-old",
          revertedAssetId: "asset-new",
          reason: "Не подходит для профиля"
        }
      })
    })

    it("сбрасывает кеш страниц автора, чей аватар вернули", async () => {
      const { ctx, cache } = withPrevious()

      await revertAccountAvatar(ctx, { userId: "author-1", reason: "Нарушает правила профиля" })

      expect(cache.dropped).toEqual(["author:vera", "home"])
    })

    it("без предыдущей версии — CONFLICT, журнал не пишется", async () => {
      const { ctx, auditLogs } = createContext({
        actor: { id: "moderator-1", role: "moderator" },
        users: [memoryUser({ id: "author-1", avatarAssetId: "asset-new" })]
      })

      await expect(
        revertAccountAvatar(ctx, { userId: "author-1", reason: "Нарушает правила профиля" })
      ).rejects.toMatchObject({
        extensions: { code: "CONFLICT", entity: "avatar" }
      })
      expect(auditLogs).toHaveLength(0)
    })

    it("неизвестный аккаунт — NOT_FOUND", async () => {
      const { ctx } = createContext({ actor: { id: "moderator-1", role: "moderator" } })

      await expect(
        revertAccountAvatar(ctx, { userId: "нет-такого", reason: "Нарушает правила профиля" })
      ).rejects.toMatchObject({
        extensions: { code: "NOT_FOUND", entity: "user" }
      })
    })

    it("автор чужой аватар не откатывает (матрица #120)", async () => {
      const { ctx, auditLogs } = createContext({
        actor: { id: "author-2", role: "author" },
        users: [memoryUser({ id: "author-1", avatarAssetId: "asset-new", prevAvatarId: "asset-old" })]
      })

      await expect(
        revertAccountAvatar(ctx, { userId: "author-1", reason: "Нарушает правила профиля" })
      ).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN", action: "profile.review.decide" }
      })
      expect(auditLogs).toHaveLength(0)
    })

    it("owner и admin откат выполняют", async () => {
      for (const role of ["owner", "admin"]) {
        const { ctx, users } = createContext({
          actor: { id: `staff-${role}`, role },
          users: [memoryUser({ id: "author-1", avatarAssetId: "asset-new", prevAvatarId: "asset-old" })],
          assets: [{ id: "asset-old", processingStatus: "ready", deletedAt: null, variants: READY_VARIANTS }]
        })

        await revertAccountAvatar(ctx, { userId: "author-1", reason: "Нарушает правила профиля" })
        expect(users.find((user) => user.id === "author-1")!.avatarAssetId).toBe("asset-old")
      }
    })

    it("требует понятную пользователю причину отката", async () => {
      const { ctx, auditLogs } = withPrevious()

      await expect(revertAccountAvatar(ctx, { userId: "author-1", reason: "  " })).rejects.toMatchObject({
        extensions: { code: "VALIDATION_ERROR", field: "reason", rule: "required" }
      })
      expect(auditLogs).toHaveLength(0)
    })
  })

  describe("признак открытой загрузки (журнал §33 п. 3)", () => {
    it("при выключенной загрузке мутация отвечает FORBIDDEN и файла не читает", async () => {
      const { ctx, uploadAvatar } = createContext({ uploadEnabled: false })

      await expect(uploadAccountAvatar(ctx, { file })).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN", action: "profile.update" }
      })
      expect(uploadAvatar).not.toHaveBeenCalled()
    })
  })

  describe("точка входа API", () => {
    it("файл не из multipart-запроса — VALIDATION_ERROR", async () => {
      const { ctx } = createContext()

      await expect(avatarResolver.Mutation.uploadAvatar({}, { file: "строка" }, ctx)).rejects.toMatchObject({
        extensions: { code: "VALIDATION_ERROR", field: "file", rule: "required" }
      })
    })

    it("поле avatar отдаёт только свою запись", async () => {
      const { ctx } = createContext({
        actor: { id: "author-1", avatarAssetId: "asset-old" },
        assets: [{ id: "asset-old", processingStatus: "ready", deletedAt: null, variants: READY_VARIANTS }]
      })

      await expect(
        avatarResolver.AccountUser.avatar({ id: "author-1", avatarAssetId: "asset-old" }, {}, ctx)
      ).resolves.toMatchObject({ assetId: "asset-old" })

      await expect(
        avatarResolver.AccountUser.avatar({ id: "author-2", avatarAssetId: "asset-old" }, {}, ctx)
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } })
    })
  })
})
