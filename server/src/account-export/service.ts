import { createApiError } from "../errors/graphql-error"
import { exportKey, parseStorageKey } from "../storage/keys"
import { MAX_SIGNED_URL_SECONDS, type ObjectStorage } from "../storage/types"
import { createStoredZip, type ZipEntry } from "./zip"
import {
  ACCOUNT_EXPORT_RETENTION_MS,
  ACCOUNT_EXPORT_SCOPES,
  type AccountExportRecord,
  type AccountExportScope,
  type AccountExportStatus,
  type AccountExportStore,
  type AccountExportView,
  type ExportArticle,
  type ExportMedia
} from "./types"

interface AccountExportServiceOptions {
  store: AccountExportStore
  storage: ObjectStorage
  now?: () => Date
}

function statusOf(record: AccountExportRecord, now: Date): AccountExportStatus {
  if (record.readyAt && record.expiresAt) return record.expiresAt.getTime() <= now.getTime() ? "expired" : "ready"
  if (record.jobStatus === "running") return "running"
  if (record.jobStatus === "queued") return "queued"
  if (record.jobStatus === "stuck") return "stuck"
  return "failed"
}

function viewOf(record: AccountExportRecord, now: Date): AccountExportView {
  return {
    id: record.id,
    requestedAt: record.requestedAt.toISOString(),
    status: statusOf(record, now),
    sizeBytes: record.sizeBytes,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    scope: record.scope
  }
}

function normalizeScope(scope: readonly AccountExportScope[], requestId: string): AccountExportScope[] {
  const unique = [...new Set(scope)]
  if (unique.length === 0 || unique.some((value) => !ACCOUNT_EXPORT_SCOPES.includes(value))) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "scope", rule: "supported_non_empty" })
  }
  return ACCOUNT_EXPORT_SCOPES.filter((value) => unique.includes(value))
}

const json = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8")

function articleForArchive(article: ExportArticle) {
  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    sourceLocale: article.sourceLocale,
    status: article.status,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
    translations: article.translations.map((translation) => ({
      id: translation.id,
      locale: translation.locale,
      title: translation.title,
      dek: translation.dek,
      excerpt: translation.excerpt,
      body: translation.body,
      status: translation.status,
      rejected: translation.rejected,
      revisions: translation.revisions
    }))
  }
}

function mediaMetadata(media: ExportMedia) {
  return {
    id: media.id,
    mimeType: media.mimeType,
    byteSize: media.byteSize,
    width: media.width,
    height: media.height,
    sha256: media.sha256,
    focalX: media.focalX,
    focalY: media.focalY,
    alt: media.alt,
    caption: media.caption,
    attribution: media.attribution,
    license: media.license,
    licenseNote: media.licenseNote,
    createdAt: media.createdAt
  }
}

function reviewForArchive(articles: readonly ExportArticle[]) {
  return articles.flatMap((article) =>
    article.translations.flatMap((translation) =>
      translation.reviewMessages.map((message) => ({
        articleId: article.id,
        translationId: translation.id,
        locale: translation.locale,
        ...message
      }))
    )
  )
}

async function archiveEntries(
  record: AccountExportRecord,
  store: AccountExportStore,
  storage: ObjectStorage,
  createdAt: Date
): Promise<ZipEntry[]> {
  const snapshot = await store.readSnapshot(record.userId)
  if (!snapshot) throw new Error("Account export subject not found")
  const entries: ZipEntry[] = [
    {
      name: "manifest.json",
      body: json({ schemaVersion: 1, exportId: record.id, createdAt, scope: record.scope })
    }
  ]

  if (record.scope.includes("profile")) {
    entries.push(
      { name: "profile.json", body: json(snapshot.profile) },
      { name: "consents.json", body: json(snapshot.consents) },
      { name: "sessions.json", body: json(snapshot.sessions) },
      { name: "bookmarks.json", body: json(snapshot.bookmarks) }
    )
  }
  if (record.scope.includes("articles")) {
    entries.push(
      ...snapshot.articles.map((article) => ({
        name: `articles/${article.id}.json`,
        body: json(articleForArchive(article))
      }))
    )
  }
  if (record.scope.includes("review")) {
    entries.push({ name: "review/messages.json", body: json(reviewForArchive(snapshot.articles)) })
  }
  if (record.scope.includes("media")) {
    entries.push({ name: "media/metadata.json", body: json(snapshot.media.map(mediaMetadata)) })
    for (const media of snapshot.media) {
      const parsed = parseStorageKey(media.storageKey)
      if (!parsed || parsed.kind !== "master") throw new Error("Account export media is not a master object")
      const original = await storage.get(media.storageKey)
      if (!original) throw new Error("Account export media master is missing")
      entries.push({ name: `media/originals/${media.id}.${parsed.extension}`, body: original.body })
    }
  }
  return entries
}

export function createAccountExportService(options: AccountExportServiceOptions) {
  const now = options.now ?? (() => new Date())

  return {
    async request(
      userId: string,
      requestedScope: readonly AccountExportScope[],
      requestId: string
    ): Promise<AccountExportView> {
      const scope = normalizeScope(requestedScope, requestId)
      const requestedAt = now()
      const outcome = await options.store.createRequest({ userId, scope, requestedAt, requestId })
      if (outcome.kind === "conflict") {
        throw createApiError("CONFLICT", {
          requestId,
          entity: "account_export",
          expected: "no_active_export",
          actual: outcome.active.jobStatus
        })
      }
      if (outcome.kind === "rate_limited") {
        throw createApiError("RATE_LIMITED", { requestId, retryAfter: outcome.retryAfterSeconds })
      }
      return viewOf(outcome.export, requestedAt)
    },

    async list(userId: string): Promise<AccountExportView[]> {
      const current = now()
      return (await options.store.list(userId)).map((record) => viewOf(record, current))
    },

    async build(id: string): Promise<void> {
      const record = await options.store.findForBuild(id)
      if (!record) throw new Error("Account export record not found")
      const readyAt = now()
      const body = createStoredZip(await archiveEntries(record, options.store, options.storage, readyAt))
      const storageKey = exportKey({ userId: record.userId, exportId: record.id, extension: "zip" })
      await options.storage.put(storageKey, body, { contentType: "application/zip" })
      await options.store.markReady(record.id, {
        storageKey,
        sizeBytes: body.length,
        readyAt,
        expiresAt: new Date(readyAt.getTime() + ACCOUNT_EXPORT_RETENTION_MS)
      })
    },

    async download(userId: string, id: string, requestId: string): Promise<string> {
      const record = await options.store.findOwned(userId, id)
      const current = now()
      if (!record || statusOf(record, current) !== "ready" || !record.storageKey || !record.expiresAt) {
        throw createApiError("NOT_FOUND", { requestId, entity: "account_export" })
      }
      const remaining = Math.floor((record.expiresAt.getTime() - current.getTime()) / 1_000)
      if (remaining < 1) throw createApiError("NOT_FOUND", { requestId, entity: "account_export" })
      return options.storage.signedGetUrl(record.storageKey, {
        expiresInSeconds: Math.min(remaining, MAX_SIGNED_URL_SECONDS),
        now: current
      })
    }
  }
}

export type AccountExportService = ReturnType<typeof createAccountExportService>
