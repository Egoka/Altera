import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  createAccountExportJobHandler,
  createAccountExportService,
  type AccountExportRecord,
  type AccountExportSnapshot,
  type AccountExportStore
} from "../src/account-export"
import type { ClaimedJob } from "../src/jobs/job-worker"
import { createMemoryStorage } from "./helpers/media-memory"

const NOW = new Date("2026-09-29T12:00:00.000Z")
const USER_ID = "10000000-0000-4000-8000-000000000001"
const OTHER_USER_ID = "10000000-0000-4000-8000-000000000002"
const MEDIA_ID = "20000000-0000-4000-8000-000000000001"
const MASTER_KEY = `2026/09/${MEDIA_ID}.jpg`

function readStoredZip(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>()
  let offset = 0
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compression = buffer.readUInt16LE(offset + 8)
    const size = buffer.readUInt32LE(offset + 18)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const bodyStart = nameStart + nameLength + extraLength
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8")
    if (compression !== 0) throw new Error("Test reader only accepts stored ZIP entries")
    entries.set(name, buffer.subarray(bodyStart, bodyStart + size))
    offset = bodyStart + size
  }
  return entries
}

function snapshot(): AccountExportSnapshot {
  return {
    profile: {
      id: USER_ID,
      name: "Мария Автор",
      email: "author@example.test",
      bio: "Автор",
      handle: "maria",
      locale: "ru",
      role: "author",
      socialLinks: { website: "https://example.test" },
      createdAt: new Date("2026-01-02T03:04:05.000Z")
    },
    consents: [{ kind: "privacy", version: 3, acceptedAt: new Date("2026-01-02T03:05:00.000Z") }],
    sessions: [
      {
        id: "session-1",
        userAgent: "Example Browser",
        createdAt: new Date("2026-02-01T10:00:00.000Z"),
        lastUsedAt: new Date("2026-02-02T10:00:00.000Z"),
        expiresAt: new Date("2026-10-01T10:00:00.000Z"),
        revokedAt: null
      }
    ],
    bookmarks: [{ articleId: "article-bookmarked", createdAt: new Date("2026-02-03T10:00:00.000Z") }],
    articles: [
      {
        id: "article-1",
        title: "Материал",
        slug: "material",
        sourceLocale: "ru",
        status: "published",
        createdAt: new Date("2026-03-01T10:00:00.000Z"),
        updatedAt: new Date("2026-03-02T10:00:00.000Z"),
        translations: [
          {
            id: "translation-1",
            locale: "ru",
            title: "Материал",
            dek: null,
            excerpt: null,
            body: { type: "doc", content: [] },
            status: "published",
            rejected: false,
            revisions: [
              {
                id: "revision-1",
                title: "Материал — первая версия",
                dek: null,
                excerpt: null,
                body: { type: "doc", content: [{ type: "paragraph" }] },
                kind: "manual",
                note: null,
                createdAt: new Date("2026-03-01T10:30:00.000Z")
              }
            ],
            reviewMessages: [
              {
                id: "review-1",
                kind: "rework_request",
                text: "Нужно уточнить источник",
                recommendations: "Добавьте ссылку",
                participantRole: "editor",
                createdAt: new Date("2026-03-01T11:00:00.000Z")
              },
              {
                id: "review-2",
                kind: "author_reply",
                text: "Источник добавлен",
                recommendations: null,
                participantRole: "author",
                createdAt: new Date("2026-03-01T12:00:00.000Z")
              }
            ]
          }
        ]
      }
    ],
    media: [
      {
        id: MEDIA_ID,
        storageKey: MASTER_KEY,
        mimeType: "image/jpeg",
        byteSize: 12,
        width: 1200,
        height: 800,
        sha256: "abc123",
        focalX: 0.4,
        focalY: 0.6,
        alt: "Река",
        caption: "Вечер",
        attribution: "Фото автора",
        license: "own",
        licenseNote: null,
        createdAt: new Date("2026-03-01T09:00:00.000Z")
      }
    ]
  }
}

function memoryStore(data = snapshot()) {
  const rows = new Map<string, AccountExportRecord>()
  const store: AccountExportStore = {
    async createRequest({ userId, scope, requestedAt }) {
      const active = [...rows.values()].find(
        (row) => row.userId === userId && ["queued", "running"].includes(row.jobStatus)
      )
      if (active) return { kind: "conflict", active } as const
      const recent = [...rows.values()].find(
        (row) => row.userId === userId && requestedAt.getTime() - row.requestedAt.getTime() < 86_400_000
      )
      if (recent) return { kind: "rate_limited", retryAfterSeconds: 3600 } as const

      const id = randomUUID()
      const row: AccountExportRecord = {
        id,
        userId,
        jobId: randomUUID(),
        jobStatus: "queued",
        scope,
        requestedAt,
        readyAt: null,
        expiresAt: null,
        storageKey: null,
        sizeBytes: null
      }
      rows.set(id, row)
      return { kind: "created", export: row } as const
    },
    async list(userId) {
      return [...rows.values()].filter((row) => row.userId === userId)
    },
    async findOwned(userId, id) {
      const row = rows.get(id)
      return row?.userId === userId ? row : null
    },
    async findForBuild(id) {
      return rows.get(id) ?? null
    },
    async readSnapshot(userId) {
      return userId === USER_ID ? data : null
    },
    async markReady(id, ready) {
      const row = rows.get(id)
      if (!row) throw new Error("missing export")
      Object.assign(row, ready, { jobStatus: "completed" as const })
    }
  }
  return { store, rows }
}

describe("выгрузка данных аккаунта", () => {
  it("кладёт в ZIP документы, мастер-оригиналы и переписку с ролями без вариантов и имён сотрудников", async () => {
    const { store, rows } = memoryStore()
    const storage = createMemoryStorage()
    storage.objects.set(MASTER_KEY, { body: Buffer.from("master-bytes"), contentType: "image/jpeg" })
    storage.objects.set(`2026/09/${MEDIA_ID}/w640.webp`, {
      body: Buffer.from("thumbnail-bytes"),
      contentType: "image/webp"
    })
    const service = createAccountExportService({ store, storage, now: () => NOW })

    const requested = await service.request(USER_ID, ["profile", "articles", "media", "review"], "request-1")
    await service.build(requested.id)

    const ready = rows.get(requested.id)
    expect(ready).toMatchObject({ jobStatus: "completed", sizeBytes: expect.any(Number) })
    const stored = storage.objects.get(ready?.storageKey ?? "")
    expect(stored?.contentType).toBe("application/zip")
    const entries = readStoredZip(stored?.body ?? Buffer.alloc(0))

    expect([...entries.keys()].sort()).toEqual([
      `articles/article-1.json`,
      "bookmarks.json",
      "consents.json",
      "manifest.json",
      `media/metadata.json`,
      `media/originals/${MEDIA_ID}.jpg`,
      "profile.json",
      `review/messages.json`,
      "sessions.json"
    ])
    expect(entries.get(`media/originals/${MEDIA_ID}.jpg`)?.toString()).toBe("master-bytes")
    expect(entries.get(`articles/article-1.json`)?.toString()).toContain('"revisions"')
    expect(entries.get("review/messages.json")?.toString()).toContain('"participantRole": "editor"')
    expect(entries.get("review/messages.json")?.toString()).toContain('"participantRole": "author"')

    const archiveText = stored?.body.toString("utf8") ?? ""
    expect(archiveText).not.toContain("thumbnail-bytes")
    expect(archiveText).not.toContain('"variants"')
    expect(archiveText).not.toContain('"storageKey"')
    expect(archiveText).not.toContain('"ip"')
  })

  it("выдаёт ссылку только владельцу готовой неистёкшей выгрузки", async () => {
    const { store } = memoryStore()
    const storage = createMemoryStorage()
    storage.objects.set(MASTER_KEY, { body: Buffer.from("master-bytes"), contentType: "image/jpeg" })
    const service = createAccountExportService({ store, storage, now: () => NOW })
    const requested = await service.request(USER_ID, ["profile", "articles", "media", "review"], "request-2")
    await service.build(requested.id)

    await expect(service.download(USER_ID, requested.id, "download-1")).resolves.toMatch(/^memory:\/\/exports\//)
    await expect(service.download(OTHER_USER_ID, requested.id, "download-2")).rejects.toMatchObject({
      extensions: { code: "NOT_FOUND" }
    })
  })

  it("отмечает готовую выгрузку истёкшей и больше не подписывает ссылку", async () => {
    const { store, rows } = memoryStore()
    const storage = createMemoryStorage()
    storage.objects.set(MASTER_KEY, { body: Buffer.from("master-bytes"), contentType: "image/jpeg" })
    let now = NOW
    const service = createAccountExportService({ store, storage, now: () => now })
    const requested = await service.request(USER_ID, ["profile", "articles", "media", "review"], "request-3")
    await service.build(requested.id)
    now = new Date(NOW.getTime() + 7 * 86_400_000 + 1)

    await expect(service.list(USER_ID)).resolves.toMatchObject([{ id: requested.id, status: "expired" }])
    await expect(service.download(USER_ID, requested.id, "download-3")).rejects.toMatchObject({
      extensions: { code: "NOT_FOUND" }
    })
    expect(rows.get(requested.id)?.storageKey).toBeTruthy()
  })

  it("передаёт exportId из фонового задания в сборщик и отвергает испорченные параметры", async () => {
    const built: string[] = []
    const handler = createAccountExportJobHandler({ build: async (id: string) => void built.push(id) })
    const job = {
      id: "job-1",
      kind: "account.export",
      parameters: { exportId: "export-1" },
      originRequestId: "request-1",
      attemptCount: 1,
      maxAttempts: 3,
      createdAt: NOW,
      startedAt: NOW
    } satisfies ClaimedJob

    await handler(job)
    expect(built).toEqual(["export-1"])
    await expect(handler({ ...job, parameters: {} })).rejects.toThrow("parameters are invalid")
  })
})
