import { randomUUID } from "node:crypto"
import { Prisma, PrismaClient } from "../generated/prisma"
import { ACCOUNT_EXPORT_JOB_KIND, ACCOUNT_EXPORT_SCOPES } from "./types"
import type {
  AccountExportRecord,
  AccountExportScope,
  AccountExportSnapshot,
  AccountExportStore,
  ExportArticle
} from "./types"

const REQUEST_LIMIT_MS = 24 * 60 * 60 * 1_000

const recordSelect = {
  id: true,
  userId: true,
  jobId: true,
  scope: true,
  storageKey: true,
  sizeBytes: true,
  readyAt: true,
  expiresAt: true,
  requestedAt: true,
  job: { select: { status: true } }
} satisfies Prisma.AccountExportSelect

type ExportRow = Prisma.AccountExportGetPayload<{ select: typeof recordSelect }>

function scopeFromJson(value: Prisma.JsonValue): AccountExportScope[] {
  if (!Array.isArray(value)) throw new Error("Account export scope is invalid")
  const scope = value.filter(
    (item): item is AccountExportScope =>
      typeof item === "string" && ACCOUNT_EXPORT_SCOPES.includes(item as AccountExportScope)
  )
  if (scope.length !== value.length || scope.length === 0) throw new Error("Account export scope is invalid")
  return scope
}

function toRecord(row: ExportRow): AccountExportRecord {
  return {
    id: row.id,
    userId: row.userId,
    jobId: row.jobId,
    jobStatus: row.job.status,
    scope: scopeFromJson(row.scope),
    requestedAt: row.requestedAt,
    readyAt: row.readyAt,
    expiresAt: row.expiresAt,
    storageKey: row.storageKey,
    sizeBytes: row.sizeBytes
  }
}

function participantRole(kind: string, byRole: string | null): string {
  if (kind === "author_reply") return "author"
  return byRole ?? "system"
}

export function createPrismaAccountExportStore(client: PrismaClient): AccountExportStore {
  return {
    async createRequest(input) {
      return client.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`

        const active = await transaction.accountExport.findFirst({
          where: { userId: input.userId, job: { status: { in: ["queued", "running"] } } },
          orderBy: { requestedAt: "desc" },
          select: recordSelect
        })
        if (active) return { kind: "conflict" as const, active: toRecord(active) }

        const recent = await transaction.accountExport.findFirst({
          where: {
            userId: input.userId,
            requestedAt: { gt: new Date(input.requestedAt.getTime() - REQUEST_LIMIT_MS) }
          },
          orderBy: { requestedAt: "desc" },
          select: { requestedAt: true }
        })
        if (recent) {
          return {
            kind: "rate_limited" as const,
            retryAfterSeconds: Math.max(
              1,
              Math.ceil((recent.requestedAt.getTime() + REQUEST_LIMIT_MS - input.requestedAt.getTime()) / 1_000)
            )
          }
        }

        const exportId = randomUUID()
        const created = await transaction.accountExport.create({
          data: {
            id: exportId,
            user: { connect: { id: input.userId } },
            scope: [...input.scope],
            requestedAt: input.requestedAt,
            job: {
              create: {
                id: randomUUID(),
                kind: ACCOUNT_EXPORT_JOB_KIND,
                objectType: "AccountExport",
                objectId: exportId,
                parameters: { exportId },
                originRequestId: input.requestId,
                manualRetryAllowed: false
              }
            }
          },
          select: recordSelect
        })
        return { kind: "created" as const, export: toRecord(created) }
      })
    },

    async list(userId) {
      const rows = await client.accountExport.findMany({
        where: { userId },
        orderBy: { requestedAt: "desc" },
        select: recordSelect
      })
      return rows.map(toRecord)
    },

    async findOwned(userId, id) {
      const row = await client.accountExport.findFirst({ where: { id, userId }, select: recordSelect })
      return row ? toRecord(row) : null
    },

    async findForBuild(id) {
      const row = await client.accountExport.findUnique({ where: { id }, select: recordSelect })
      return row ? toRecord(row) : null
    },

    async readSnapshot(userId): Promise<AccountExportSnapshot | null> {
      const user = await client.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          bio: true,
          handle: true,
          locale: true,
          role: true,
          socialLinks: true,
          createdAt: true,
          legalConsents: {
            orderBy: { acceptedAt: "asc" },
            select: { acceptedAt: true, legalText: { select: { kind: true, version: true } } }
          },
          sessions: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              userAgent: true,
              createdAt: true,
              lastUsedAt: true,
              expiresAt: true,
              revokedAt: true
            }
          },
          bookmarks: { orderBy: { createdAt: "asc" }, select: { articleId: true, createdAt: true } },
          articles: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              title: true,
              slug: true,
              sourceLocale: true,
              status: true,
              createdAt: true,
              updatedAt: true,
              translations: {
                orderBy: { locale: "asc" },
                select: {
                  id: true,
                  locale: true,
                  title: true,
                  dek: true,
                  excerpt: true,
                  body: true,
                  status: true,
                  rejected: true,
                  revisions: {
                    orderBy: { createdAt: "asc" },
                    select: {
                      id: true,
                      title: true,
                      dek: true,
                      excerpt: true,
                      body: true,
                      kind: true,
                      note: true,
                      createdAt: true
                    }
                  },
                  reviewMessages: {
                    orderBy: { createdAt: "asc" },
                    select: {
                      id: true,
                      kind: true,
                      text: true,
                      recommendations: true,
                      byRole: true,
                      createdAt: true
                    }
                  }
                }
              }
            }
          },
          ownedMediaAssets: {
            where: { deletedAt: null, processingStatus: "ready" },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              storageKey: true,
              mimeType: true,
              byteSize: true,
              width: true,
              height: true,
              sha256: true,
              focalX: true,
              focalY: true,
              alt: true,
              caption: true,
              attribution: true,
              license: true,
              licenseNote: true,
              createdAt: true
            }
          }
        }
      })
      if (!user) return null

      const articles: ExportArticle[] = user.articles.map((article) => ({
        ...article,
        translations: article.translations.map((translation) => ({
          ...translation,
          reviewMessages: translation.reviewMessages.map(({ byRole, ...message }) => ({
            ...message,
            participantRole: participantRole(message.kind, byRole)
          }))
        }))
      }))

      return {
        profile: {
          id: user.id,
          name: user.name,
          email: user.email,
          bio: user.bio,
          handle: user.handle,
          locale: user.locale,
          role: user.role,
          socialLinks: user.socialLinks,
          createdAt: user.createdAt
        },
        consents: user.legalConsents.map(({ legalText, acceptedAt }) => ({ ...legalText, acceptedAt })),
        sessions: user.sessions,
        bookmarks: user.bookmarks,
        articles,
        media: user.ownedMediaAssets
      }
    },

    async markReady(id, ready) {
      await client.accountExport.update({ where: { id }, data: ready })
    }
  }
}
