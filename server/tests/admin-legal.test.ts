import { describe, expect, it, vi } from "vitest"
import { Prisma } from "../src/generated/prisma"
import type { GraphQLContext } from "../src/prisma"
import {
  createLegalDraft,
  getAdminLegalVersion,
  listAdminLegalKinds,
  listAdminLegalVersions,
  publishLegalDraft
} from "../src/admin/legal"

/**
 * T-083: раздел `/admin/legal` (`docs/spec/40-admin/legal-texts.md`). Двойник Prisma проверяет
 * права (§1, матрица #96), аудит `legal.update` (§8), конфликт черновика (§9) и сброс кеша
 * публичной страницы; каскад статусов и номера на настоящей базе — `legal-versions-database`.
 */

type TestRole = "author" | "editor" | "admin" | "owner"

const updatedAt = new Date("2026-09-21T10:00:00.000Z")
const now = new Date("2026-09-21T12:00:00.000Z")

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "text-1",
  kind: "terms",
  locale: "ru",
  version: 3,
  status: "draft",
  isMaterial: false,
  summaryOfChanges: "Уточнён раздел",
  publishedAt: null,
  publishedByRole: null,
  createdAt: updatedAt,
  updatedAt,
  _count: { consents: 0 },
  ...overrides
})

function context(
  role: TestRole | null,
  options: { draft?: Record<string, unknown> | null; latest?: number; staleWrite?: boolean } = {}
) {
  const calls: string[] = []
  let written: Record<string, unknown> = {}
  const legalText = {
    findMany: vi.fn(async () => [
      { kind: "terms", locale: "ru", version: 2, status: "published", publishedAt: updatedAt },
      { kind: "terms", locale: "ru", version: 3, status: "draft", publishedAt: null }
    ]),
    findFirst: vi.fn(async (args: { where: { status?: unknown; isMaterial?: boolean } }) => {
      if (args.where.status === "draft") return options.draft === undefined ? null : options.draft
      if (args.where.isMaterial) return { version: 2 }
      if (args.where.status === "published") return { version: 2, body: "<p>v2</p>" }
      return options.latest === undefined ? { version: 2 } : { version: options.latest }
    }),
    findUnique: vi.fn(async () => (options.draft === undefined ? null : options.draft)),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      calls.push("create")
      return row(data)
    }),
    updateMany: vi.fn(async (args: { where: { id?: string }; data: Record<string, unknown> }) => {
      calls.push(`updateMany ${JSON.stringify(args)}`)
      if (args.where.id) {
        if (options.staleWrite) return { count: 0 }
        written = { ...written, ...args.data }
      }
      return { count: 1 }
    }),
    findUniqueOrThrow: vi.fn(async () => row({ ...options.draft, ...written }))
  }
  const auditLog = { create: vi.fn(async () => ({ id: "audit-1" })) }
  const user = {
    count: vi.fn(async (args: { where: { legalConsents?: unknown } }) => (args.where.legalConsents ? 7 : 10))
  }
  const cache = { delByTags: vi.fn(async () => undefined) }
  const prisma = {
    legalText,
    auditLog,
    user,
    $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run({ legalText, auditLog }))
  }
  const ctx = {
    currentUser: role
      ? { id: `${role}-1`, role, archivedAt: null, planTier: "free", planUntil: null, permissionExceptions: [] }
      : null,
    requestId: "req-legal",
    prisma,
    cache
  } as unknown as GraphQLContext
  return { ctx, calls, legalText, auditLog, cache }
}

const draftInput = {
  kind: "terms" as const,
  locale: "ru" as const,
  body: '<h2 id="a">A</h2>',
  summaryOfChanges: "Правка"
}

describe("права раздела", () => {
  it("без сессии — UNAUTHENTICATED, роли ниже admin — FORBIDDEN legal.read", async () => {
    await expect(listAdminLegalKinds(context(null).ctx)).rejects.toMatchObject({
      extensions: { code: "UNAUTHENTICATED" }
    })
    for (const role of ["author", "editor"] as const) {
      await expect(listAdminLegalVersions(context(role).ctx)).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN", action: "legal.read" }
      })
    }
  })

  it("admin читает версии и статистику, но не создаёт и не публикует (perm owner)", async () => {
    const world = context("admin", { draft: row() })

    const kinds = await listAdminLegalKinds(world.ctx)
    expect(kinds.map((kind) => kind.kind)).toEqual([
      "terms",
      "privacy",
      "content_rules",
      "license",
      "paid_services",
      "refunds",
      "about"
    ])
    expect(kinds[0]).toMatchObject({
      requiresConsent: true,
      locales: [
        { locale: "ru", currentVersion: 2, draftVersion: 3, usersTotal: 10, usersWithCurrentConsent: 7 },
        { locale: "en", currentVersion: null, draftVersion: null, usersTotal: null }
      ]
    })
    expect(kinds[3]).toMatchObject({ requiresConsent: false })

    await expect(createLegalDraft(world.ctx, draftInput)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN", action: "legal.update" }
    })
    await expect(
      publishLegalDraft(world.ctx, {
        kind: "terms",
        locale: "ru",
        version: 3,
        isMaterial: false,
        draftUpdatedAt: updatedAt.toISOString()
      })
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN", action: "legal.update" } })
    expect(world.auditLog.create).not.toHaveBeenCalled()
  })

  it("карточка черновика несёт действующую редакцию для сравнения и число затронутых", async () => {
    const detail = await getAdminLegalVersion(context("admin", { draft: row({ body: "<p>v3</p>" }) }).ctx, {
      kind: "terms",
      locale: "ru",
      version: 3
    })
    expect(detail).toMatchObject({
      version: 3,
      current: { version: 2, body: "<p>v2</p>" },
      requiresConsent: true,
      affectedUsers: 10,
      pendingConsentCount: null
    })
  })
})

describe("черновик", () => {
  it("owner создаёт черновик со следующим номером и пишет legal.update без полного текста", async () => {
    const world = context("owner")

    const saved = await createLegalDraft(world.ctx, draftInput)

    expect(saved).toMatchObject({ status: "draft", version: 3, consentCount: 0 })
    expect(world.legalText.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 3, status: "draft" }) })
    )
    const audit = world.auditLog.create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(audit.data).toMatchObject({
      action: "legal.update",
      actorRole: "owner",
      entityType: "legalText",
      diff: { kind: "terms", locale: "ru", version: 3, stage: "draft", summaryOfChanges: "Правка" }
    })
    expect(JSON.stringify(audit.data.diff)).not.toContain("<h2")
  })

  it("правка черновика другим owner после чужого сохранения — CONFLICT", async () => {
    const world = context("owner", { draft: row() })

    await expect(createLegalDraft(world.ctx, draftInput)).rejects.toMatchObject({
      extensions: { code: "CONFLICT", entity: "legalText" }
    })
    await expect(
      createLegalDraft(world.ctx, { ...draftInput, draftUpdatedAt: "2026-09-21T09:00:00.000Z" })
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } })

    const saved = await createLegalDraft(world.ctx, { ...draftInput, draftUpdatedAt: updatedAt.toISOString() })
    expect(saved.version).toBe(3)
    expect(world.calls).toEqual([expect.stringContaining('"summaryOfChanges":"Правка"')])
  })

  it("два owner одновременно создают первый черновик: уникальный номер даёт CONFLICT, а не 500", async () => {
    const world = context("owner")
    world.ctx.prisma.$transaction = vi.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test"
      })
    }) as never
    await expect(createLegalDraft(world.ctx, draftInput)).rejects.toMatchObject({
      extensions: { code: "CONFLICT", expected: "new-draft", actual: "draft-exists" }
    })
  })

  it("правка уже опубликованного черновика — CONFLICT", async () => {
    await expect(
      createLegalDraft(context("owner").ctx, { ...draftInput, draftUpdatedAt: updatedAt.toISOString() })
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT", expected: "draft", actual: "missing" } })
  })

  it("отклоняет активную разметку и пустое описание изменений", async () => {
    const world = context("owner")
    await expect(createLegalDraft(world.ctx, { ...draftInput, body: '<p onclick="x()">a</p>' })).rejects.toMatchObject({
      extensions: { code: "VALIDATION_ERROR", field: "body", rule: "static-html" }
    })
    await expect(createLegalDraft(world.ctx, { ...draftInput, summaryOfChanges: "  " })).rejects.toMatchObject({
      extensions: { code: "VALIDATION_ERROR", field: "summaryOfChanges", rule: "required" }
    })
    expect(world.ctx.prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe("публикация", () => {
  const publishInput = {
    kind: "terms" as const,
    locale: "ru" as const,
    version: 3,
    isMaterial: true,
    draftUpdatedAt: updatedAt.toISOString()
  }

  it("действующая уходит в прежние, черновик становится версией, аудит и сброс кеша", async () => {
    const world = context("owner", { draft: row({ body: "<p>v3</p>" }) })

    const published = await publishLegalDraft(world.ctx, publishInput, now)

    expect(world.calls[0]).toContain('"data":{"status":"previous"}')
    expect(world.calls[1]).toContain('"status":"published"')
    expect(world.calls[1]).toContain('"version":3')
    expect(world.calls[1]).toContain('"isMaterial":true')
    expect(published).toMatchObject({ status: "published", version: 3, isMaterial: true })
    expect(world.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "legal.update",
        diff: expect.objectContaining({ version: 3, stage: "published", isMaterial: true })
      })
    })
    expect(world.cache.delByTags).toHaveBeenCalledWith(["legal:terms", "home"])
  })

  it("черновик, чей номер заняла публикация релизом кода, получает следующий номер", async () => {
    const world = context("owner", { draft: row({ body: "<p>v3</p>" }), latest: 3 })
    await publishLegalDraft(world.ctx, publishInput, now)
    expect(world.calls[1]).toContain('"version":4')
  })

  it("уже опубликованная версия и устаревшая метка черновика — CONFLICT, без аудита и кеша", async () => {
    const published = context("owner", { draft: row({ status: "published", body: "<p>v3</p>" }) })
    await expect(publishLegalDraft(published.ctx, publishInput, now)).rejects.toMatchObject({
      extensions: { code: "CONFLICT", expected: "draft", actual: "published" }
    })

    const stale = context("owner", { draft: row({ body: "<p>v3</p>" }) })
    await expect(
      publishLegalDraft(stale.ctx, { ...publishInput, draftUpdatedAt: "2026-09-21T09:00:00.000Z" }, now)
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } })

    for (const world of [published, stale]) {
      expect(world.auditLog.create).not.toHaveBeenCalled()
      expect(world.cache.delByTags).not.toHaveBeenCalled()
    }
  })

  it("параллельная публикация того же черновика: условный UPDATE не проходит — CONFLICT без аудита", async () => {
    const world = context("owner", { draft: row({ body: "<p>v3</p>" }), staleWrite: true })
    await expect(publishLegalDraft(world.ctx, publishInput, now)).rejects.toMatchObject({
      extensions: { code: "CONFLICT", actual: "changed" }
    })
    expect(world.calls[1]).toContain(`"updatedAt":"${updatedAt.toISOString()}"`)
    expect(world.auditLog.create).not.toHaveBeenCalled()
    expect(world.cache.delByTags).not.toHaveBeenCalled()
  })

  it("неизвестная версия — NOT_FOUND", async () => {
    await expect(publishLegalDraft(context("owner").ctx, publishInput, now)).rejects.toMatchObject({
      extensions: { code: "NOT_FOUND", entity: "legalText" }
    })
  })
})
