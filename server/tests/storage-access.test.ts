import { mkdtemp, readdir, rm } from "node:fs/promises"
import { createServer, type RequestListener, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ArticleStatus, MediaProcessingStatus } from "../src/generated/prisma"
import {
  createPrismaPublicAccessResolver,
  decidePublicAccess,
  publicMediaUrl,
  type MediaUsageClient
} from "../src/storage/access"
import { withMedia } from "../src/storage/gateway"
import { masterKey, variantKey } from "../src/storage/keys"
import { createLocalStorage, type LocalStorage } from "../src/storage/local"
import { storageUnavailableError } from "../src/storage/types"

const assetId = "0b7e4c1a-3f2d-4c8e-9a1b-2c3d4e5f6a7b"
const createdAt = new Date("2026-09-21T10:00:00.000Z")
const original = masterKey({ assetId, createdAt, extension: "jpg" })
const variant = variantKey({ assetId, createdAt, width: 640, format: "webp" })

interface AssetState {
  deletedAt: Date | null
  processingStatus: MediaProcessingStatus
  coverArticles: { status: ArticleStatus }[]
  currentAvatarUsers: { archivedAt: Date | null }[]
}

let root: string
let server: Server
let baseUrl: string
let storage: LocalStorage
let asset: AssetState | null

const client: MediaUsageClient = {
  mediaAsset: {
    findUnique: async ({ where }) => (asset && where.id === assetId ? structuredClone(asset) : null)
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "altera-storage-"))
  asset = {
    deletedAt: null,
    processingStatus: "ready",
    coverArticles: [{ status: "published" }],
    currentAvatarUsers: []
  }
  let handler: RequestListener = () => undefined
  server = createServer((request, response) => handler(request, response))
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/media`
  storage = createLocalStorage({ root, mediaBaseUrl: baseUrl, signingSecret: "test-secret" })
  handler = withMedia(
    (_request, response) => {
      response.statusCode = 418
      response.end()
    },
    { storage, resolvePublicAccess: createPrismaPublicAccessResolver(client) }
  )
  await storage.put(original, Buffer.from("master"), { contentType: "image/jpeg" })
  await storage.put(variant, Buffer.from("variant"), { contentType: "image/webp" })
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
})

describe("локальная реализация хранилища", () => {
  it("кладёт, читает, проверяет и удаляет объект по ключу раскладки", async () => {
    await expect(storage.get(original)).resolves.toEqual({ body: Buffer.from("master"), contentType: "image/jpeg" })
    await expect(storage.exists(variant)).resolves.toBe(true)
    await storage.delete(variant)
    await expect(storage.exists(variant)).resolves.toBe(false)
    await expect(storage.get(variant)).resolves.toBeNull()
    await expect(storage.put("../escape.jpg", Buffer.from("x"), { contentType: "image/jpeg" })).rejects.toThrow(
      "Invalid storage key"
    )
    expect(await readdir(root)).toEqual(["2026"])
  })
})

describe("доступ к файлам по ссылкам", () => {
  it("критерий 1: ссылка на оригинал без подписи — отказ, с подписью — 200, просроченная — отказ", async () => {
    const unsigned = await fetch(`${baseUrl}/${original}`)
    expect(unsigned.status).toBe(404)
    expect(await unsigned.text()).not.toContain("master")

    const signed = await fetch(storage.signedGetUrl(original, { expiresInSeconds: 60 }))
    expect(signed.status).toBe(200)
    expect(signed.headers.get("cache-control")).toBe("private, no-store")
    expect(await signed.text()).toBe("master")

    const expired = storage.signedGetUrl(original, { expiresInSeconds: 60, now: new Date(Date.now() - 120_000) })
    expect((await fetch(expired)).status).toBe(403)

    const forged = new URL(storage.signedGetUrl(original, { expiresInSeconds: 60 }))
    forged.searchParams.set("expires", String(Number(forged.searchParams.get("expires")) + 3600))
    expect((await fetch(forged)).status).toBe(403)

    const otherKey = new URL(storage.signedGetUrl(variant, { expiresInSeconds: 60 }))
    otherKey.pathname = `/media/${original}`
    expect((await fetch(otherKey)).status).toBe(403)
  })

  it("критерий 2: архивирование материала закрывает публичную ссылку на его медиа, восстановление открывает", async () => {
    const url = publicMediaUrl(baseUrl, variant)
    const published = await fetch(url)
    expect(published.status).toBe(200)
    expect(published.headers.get("cache-control")).toBe("public, no-cache")
    expect(await published.text()).toBe("variant")

    asset!.coverArticles = [{ status: "archived" }]
    const archived = await fetch(url)
    expect(archived.status).toBe(404)
    expect(await archived.text()).not.toContain("variant")

    asset!.coverArticles = [{ status: "published" }]
    expect((await fetch(url)).status).toBe(200)
  })

  it("архив аккаунта закрывает публичный аватар", async () => {
    asset = {
      deletedAt: null,
      processingStatus: "ready",
      coverArticles: [],
      currentAvatarUsers: [{ archivedAt: null }]
    }
    expect((await fetch(publicMediaUrl(baseUrl, variant))).status).toBe(200)
    asset.currentAvatarUsers = [{ archivedAt: new Date() }]
    expect((await fetch(publicMediaUrl(baseUrl, variant))).status).toBe(404)
  })

  it("медиа черновика доступно автору по подписи, но не по прямой ссылке", async () => {
    asset!.coverArticles = [{ status: "draft" }]
    expect((await fetch(publicMediaUrl(baseUrl, variant))).status).toBe(404)
    expect((await fetch(storage.signedGetUrl(variant, { expiresInSeconds: 60 }))).status).toBe(200)
  })

  it("незнакомые пути и неизвестные медиа — 404, чужие маршруты уходят дальше", async () => {
    asset = null
    expect((await fetch(publicMediaUrl(baseUrl, variant))).status).toBe(404)
    expect((await fetch(`${baseUrl}/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404)
    expect((await fetch(`${baseUrl}/2026/09/photo.jpg`)).status).toBe(404)
    expect((await fetch(baseUrl.replace("/media", "/graphql"))).status).toBe(418)
  })

  it("сбой базы при проверке доступа — 503 без содержимого", async () => {
    const failing = createServer(
      withMedia(() => undefined, {
        storage,
        resolvePublicAccess: async () => {
          throw new Error("database is down")
        }
      })
    )
    await new Promise<void>((resolve) => failing.listen(0, "127.0.0.1", resolve))
    const port = (failing.address() as AddressInfo).port
    const response = await fetch(`http://127.0.0.1:${port}/media/${variant}`)
    expect(response.status).toBe(503)
    expect(await response.text()).toBe("Service Unavailable")
    await new Promise<void>((resolve) => failing.close(() => resolve()))
  })
})

describe("политика публичного доступа", () => {
  const ready = {
    deletedAt: null,
    processingStatus: "ready" as const,
    coverOf: [{ status: "published" as const }],
    avatarOf: []
  }

  it("публичен только вариант готового неудалённого медиа опубликованного материала", () => {
    expect(decidePublicAccess("variant", ready)).toBe("public")
    expect(decidePublicAccess("master", ready)).toBe("closed")
    expect(decidePublicAccess("export", ready)).toBe("closed")
    expect(decidePublicAccess("variant", null)).toBe("closed")
    expect(decidePublicAccess("variant", { ...ready, deletedAt: new Date() })).toBe("closed")
    expect(decidePublicAccess("variant", { ...ready, processingStatus: "processing" })).toBe("closed")
    for (const status of ["draft", "ai_check", "review", "in_review", "rework", "archived"] as const) {
      expect(decidePublicAccess("variant", { ...ready, coverOf: [{ status }] }), status).toBe("closed")
    }
  })

  it("прямая ссылка строится только для варианта", () => {
    expect(publicMediaUrl("https://cdn.altera.test/", variant)).toBe(`https://cdn.altera.test/${variant}`)
    expect(() => publicMediaUrl("https://cdn.altera.test", original)).toThrow("Only variants")
  })

  it("сбой хранилища в API — PROVIDER_UNAVAILABLE: storage", () => {
    expect(storageUnavailableError("req-1").extensions).toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      provider: "storage",
      requestId: "req-1"
    })
  })
})
