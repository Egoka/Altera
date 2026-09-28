/**
 * T-067, критерий готовности 1: исправление `alt` у медиафайла доступно только `admin`, а автор и
 * рецензент получают `FORBIDDEN` (матрица #40, журнал §29.13). Успешное исправление пишет общую
 * оболочку аудита `admin.change` (реестр #75) со значениями до и после; нового кода события нет.
 */

import { describe, expect, it, vi } from "vitest"
import { AUDIT_CODE_ZONES } from "../src/audit/registry"
import mediaResolver from "../src/graphql/media/resolver"
import { applyAdminAlt, MAX_ALT_LENGTH, MEDIA_ASSET_ENTITY } from "../src/media/alt"
import type { MediaAssetRecord, MediaService } from "../src/media"
import type { GraphQLContext } from "../src/prisma"
import { createMemoryMediaStore, type MemoryMediaStore } from "./helpers/media-memory"

const ASSET_ID = "asset-alt-1"
const REQUEST = "req-alt-admin"
const DESCRIBED = "Река в тумане у деревянного моста"

const adminUpdateMediaAlt = mediaResolver.Mutation.adminUpdateMediaAlt

/** Медиафайл с описанием, которое создал конвейер: исправляется именно оно. */
function seed(store: MemoryMediaStore, alt: string | null = DESCRIBED): MediaAssetRecord {
  const record: MediaAssetRecord = {
    id: ASSET_ID,
    ownerId: "author-1",
    processingStatus: "ready",
    storageKey: "master/2026/09/00000000-0000-4000-8000-000000000001.jpg",
    mimeType: "image/jpeg",
    byteSize: 2048,
    width: 1200,
    height: 800,
    sha256: "checksum",
    attribution: "Иван Петров",
    license: "own",
    licenseNote: null,
    alt,
    caption: null,
    variants: [],
    focalX: null,
    focalY: null,
    deletedAt: null,
    createdAt: new Date("2026-09-28T10:00:00.000Z")
  }
  store.records.set(record.id, record)
  return record
}

function createContext(role: string, store: MemoryMediaStore) {
  const media = {
    mediaBaseUrl: "https://media.altera.test",
    updateAlt: vi.fn((input: Parameters<MediaService["updateAlt"]>[0]) => applyAdminAlt(input, { store }))
  } as unknown as MediaService

  const ctx = {
    currentUser: {
      id: `${role}-1`,
      role,
      archivedAt: null,
      planTier: "standard",
      planUntil: null,
      permissionExceptions: []
    },
    requestId: REQUEST,
    requestMeta: { ip: null, userAgent: null },
    logger: { log: vi.fn(), metric: vi.fn() },
    media
  } as unknown as GraphQLContext

  return { ctx, media }
}

describe("T-067 исправление `alt` администратором", () => {
  it("код аудита уже утверждён реестром и закрыт для служебных ролей", () => {
    expect(AUDIT_CODE_ZONES["admin.change"]).toEqual([])
  })

  it.each(["author", "moderator", "editor", "analyst"])("роль %s получает FORBIDDEN", async (role) => {
    const store = createMemoryMediaStore()
    seed(store)
    const { ctx } = createContext(role, store)

    await expect(adminUpdateMediaAlt({}, { assetId: ASSET_ID, alt: "Своё описание" }, ctx)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN", action: "media.update.meta" }
    })
    expect(store.records.get(ASSET_ID)?.alt).toBe(DESCRIBED)
    expect(store.audit).toEqual([])
  })

  it.each(["admin", "owner"])("роль %s исправляет описание и пишет `admin.change`", async (role) => {
    const store = createMemoryMediaStore()
    seed(store)
    const { ctx } = createContext(role, store)

    const result = await adminUpdateMediaAlt({}, { assetId: ASSET_ID, alt: "  Мост через Оку осенью  " }, ctx)

    expect(result).toMatchObject({ id: ASSET_ID, alt: "Мост через Оку осенью" })
    expect(store.records.get(ASSET_ID)?.alt).toBe("Мост через Оку осенью")
    expect(store.audit).toEqual([
      {
        action: "admin.change",
        actorId: `${role}-1`,
        actorRole: role,
        entityType: MEDIA_ASSET_ENTITY,
        entityId: ASSET_ID,
        diff: {
          entity: MEDIA_ASSET_ENTITY,
          entityId: ASSET_ID,
          fields: { alt: { from: DESCRIBED, to: "Мост через Оку осенью" } }
        },
        requestId: REQUEST
      }
    ])
  })

  it("пустое описание отклоняется: исправление не стирает `alt`", async () => {
    const store = createMemoryMediaStore()
    seed(store)
    const { ctx } = createContext("admin", store)

    await expect(adminUpdateMediaAlt({}, { assetId: ASSET_ID, alt: "   " }, ctx)).rejects.toMatchObject({
      extensions: { code: "VALIDATION_ERROR", field: "alt", rule: "required" }
    })
    expect(store.records.get(ASSET_ID)?.alt).toBe(DESCRIBED)
    expect(store.audit).toEqual([])
  })

  it("слишком длинное описание отклоняется", async () => {
    const store = createMemoryMediaStore()
    seed(store)
    const { ctx } = createContext("admin", store)

    await expect(
      adminUpdateMediaAlt({}, { assetId: ASSET_ID, alt: "о".repeat(MAX_ALT_LENGTH + 1) }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "VALIDATION_ERROR", field: "alt", rule: "maxLength" } })
    expect(store.audit).toEqual([])
  })

  it("удалённого медиафайла нет: NOT_FOUND без записи в журнале", async () => {
    const store = createMemoryMediaStore()
    const record = seed(store)
    store.records.set(ASSET_ID, { ...record, deletedAt: new Date("2026-09-28T11:00:00.000Z") })
    const { ctx } = createContext("admin", store)

    await expect(adminUpdateMediaAlt({}, { assetId: ASSET_ID, alt: "Описание" }, ctx)).rejects.toMatchObject({
      extensions: { code: "NOT_FOUND", entity: MEDIA_ASSET_ENTITY }
    })
    expect(store.audit).toEqual([])
  })

  it("повтор прежнего значения исправлением не считается и в журнал не идёт", async () => {
    const store = createMemoryMediaStore()
    seed(store)
    const { ctx } = createContext("admin", store)

    const result = await adminUpdateMediaAlt({}, { assetId: ASSET_ID, alt: ` ${DESCRIBED} ` }, ctx)

    expect(result).toMatchObject({ alt: DESCRIBED })
    expect(store.audit).toEqual([])
  })
})
