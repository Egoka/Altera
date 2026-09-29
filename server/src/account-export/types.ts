export const ACCOUNT_EXPORT_JOB_KIND = "account.export"
export const ACCOUNT_EXPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000

export const ACCOUNT_EXPORT_SCOPES = ["profile", "articles", "media", "review"] as const
export type AccountExportScope = (typeof ACCOUNT_EXPORT_SCOPES)[number]

export type AccountExportJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "stuck"
export type AccountExportStatus = "queued" | "running" | "ready" | "failed" | "stuck" | "expired"

export interface AccountExportRecord {
  id: string
  userId: string
  jobId: string
  jobStatus: AccountExportJobStatus
  scope: readonly AccountExportScope[]
  requestedAt: Date
  readyAt: Date | null
  expiresAt: Date | null
  storageKey: string | null
  sizeBytes: number | null
}

export interface ExportProfile {
  id: string
  name: string
  email: string
  bio: string | null
  handle: string
  locale: string
  role: string
  socialLinks: unknown
  createdAt: Date
}

export interface ExportReviewMessage {
  id: string
  kind: string
  text: string | null
  recommendations: string | null
  participantRole: string
  createdAt: Date
}

export interface ExportArticleRevision {
  id: string
  title: string
  dek: string | null
  excerpt: string | null
  body: unknown
  kind: string
  note: string | null
  createdAt: Date
}

export interface ExportArticleTranslation {
  id: string
  locale: string
  title: string
  dek: string | null
  excerpt: string | null
  body: unknown
  status: string
  rejected: boolean
  revisions: readonly ExportArticleRevision[]
  reviewMessages: readonly ExportReviewMessage[]
}

export interface ExportArticle {
  id: string
  title: string
  slug: string
  sourceLocale: string
  status: string
  createdAt: Date
  updatedAt: Date
  translations: readonly ExportArticleTranslation[]
}

export interface ExportMedia {
  id: string
  storageKey: string
  mimeType: string
  byteSize: number
  width: number | null
  height: number | null
  sha256: string
  focalX: number | null
  focalY: number | null
  alt: string | null
  caption: string | null
  attribution: string
  license: string
  licenseNote: string | null
  createdAt: Date
}

export interface AccountExportSnapshot {
  profile: ExportProfile
  consents: readonly { kind: string; version: number; acceptedAt: Date }[]
  sessions: readonly {
    id: string
    userAgent: string | null
    createdAt: Date
    lastUsedAt: Date
    expiresAt: Date
    revokedAt: Date | null
  }[]
  bookmarks: readonly { articleId: string; createdAt: Date }[]
  articles: readonly ExportArticle[]
  media: readonly ExportMedia[]
}

export type CreateExportOutcome =
  | { kind: "created"; export: AccountExportRecord }
  | { kind: "conflict"; active: AccountExportRecord }
  | { kind: "rate_limited"; retryAfterSeconds: number }

export interface AccountExportStore {
  createRequest(input: {
    userId: string
    scope: readonly AccountExportScope[]
    requestedAt: Date
    requestId: string
  }): Promise<CreateExportOutcome>
  list(userId: string): Promise<readonly AccountExportRecord[]>
  findOwned(userId: string, id: string): Promise<AccountExportRecord | null>
  findForBuild(id: string): Promise<AccountExportRecord | null>
  readSnapshot(userId: string): Promise<AccountExportSnapshot | null>
  markReady(id: string, ready: { storageKey: string; sizeBytes: number; readyAt: Date; expiresAt: Date }): Promise<void>
}

export interface AccountExportView {
  id: string
  requestedAt: string
  status: AccountExportStatus
  sizeBytes: number | null
  expiresAt: string | null
  scope: readonly AccountExportScope[]
}
