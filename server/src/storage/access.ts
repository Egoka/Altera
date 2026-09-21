import type { ArticleStatus, MediaProcessingStatus } from "../generated/prisma"
import { parseStorageKey } from "./keys"

// Доступ к файлам следует за статусом материала и аккаунта (`access-and-signed-urls.md` п. 1–3).

export interface MediaUsage {
  deletedAt: Date | null
  processingStatus: MediaProcessingStatus
  /** Статусы статей, у которых медиа — обложка. */
  coverOf: readonly { status: ArticleStatus }[]
  /** Аккаунты, у которых медиа — текущий аватар. */
  avatarOf: readonly { archivedAt: Date | null }[]
}

export type PublicMediaAccess = "public" | "closed"

/**
 * Публичен только вариант готового неудалённого медиа, которое служит обложкой опубликованной
 * статьи или аватаром неархивированного аккаунта. Оригиналы и выгрузки публичными не бывают.
 */
export function decidePublicAccess(
  objectKind: "master" | "variant" | "export",
  usage: MediaUsage | null
): PublicMediaAccess {
  if (objectKind !== "variant" || !usage) return "closed"
  if (usage.deletedAt || usage.processingStatus !== "ready") return "closed"
  const publishedCover = usage.coverOf.some((article) => article.status === "published")
  const activeAvatar = usage.avatarOf.some((user) => user.archivedAt === null)
  return publishedCover || activeAvatar ? "public" : "closed"
}

/** Прямая ссылка на публичный вариант: CDN-домен или раздача сервера, не адрес бакета (п. 9). */
export function publicMediaUrl(mediaBaseUrl: string, key: string): string {
  if (parseStorageKey(key)?.kind !== "variant") throw new Error("Only variants have public URLs")
  return `${mediaBaseUrl.replace(/\/+$/, "")}/${key}`
}

/** Решение по ключу без подписи; для незнакомого ключа — `closed`. */
export type PublicAccessResolver = (key: string) => Promise<PublicMediaAccess>

export interface MediaUsageClient {
  mediaAsset: {
    findUnique(args: {
      where: { id: string }
      select: {
        deletedAt: true
        processingStatus: true
        coverArticles: { select: { status: true } }
        currentAvatarUsers: { select: { archivedAt: true } }
      }
    }): Promise<{
      deletedAt: Date | null
      processingStatus: MediaProcessingStatus
      coverArticles: { status: ArticleStatus }[]
      currentAvatarUsers: { archivedAt: Date | null }[]
    } | null>
  }
}

export function createPrismaPublicAccessResolver(client: MediaUsageClient): PublicAccessResolver {
  return async (key) => {
    const parsed = parseStorageKey(key)
    if (!parsed || parsed.kind !== "variant") return "closed"
    const asset = await client.mediaAsset.findUnique({
      where: { id: parsed.assetId },
      select: {
        deletedAt: true,
        processingStatus: true,
        coverArticles: { select: { status: true } },
        currentAvatarUsers: { select: { archivedAt: true } }
      }
    })
    if (!asset) return "closed"
    return decidePublicAccess(parsed.kind, {
      deletedAt: asset.deletedAt,
      processingStatus: asset.processingStatus,
      coverOf: asset.coverArticles,
      avatarOf: asset.currentAvatarUsers
    })
  }
}
