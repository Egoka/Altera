/**
 * Экстрактор подачи для AI-проверки (T-048, критерий готовности 2).
 *
 * Состав входа задан `docs/spec/40-admin/ai-check-criteria.md` §2: заголовок, дек, текст в порядке
 * блоков, изображения статьи вместе с обложкой и их атрибуцией, рубрика, теги, язык версии и
 * пометка 18+ автора. Имя и e-mail автора провайдеру не уходят (`legal-content-rules.md` §4,
 * `write-and-publish.md` шаг 3) — и не читаются: `AI_CHECK_SOURCE_SELECT` их не запрашивает.
 *
 * Текст блоков даёт `toPlainText` из `@altera/content`: разбор документа существует в одном месте
 * (ADR-0029, T-041), второй реализации тех же правил здесь нет.
 */

import { extractImages, readDocument, toPlainText } from "@altera/content"
import { Prisma, type PrismaClient } from "../generated/prisma"
import type { AiCheckImage, AiCheckSubmission } from "./types"

export type AiCheckSubmissionStore = Pick<PrismaClient, "articleTranslation" | "articleRevision" | "mediaAsset">

/**
 * Поля версии статьи, нужные проверке. Ни одного поля автора здесь нет: ни `author`, ни `name`,
 * ни `email`, ни `handle` — это и есть механизм запрета на передачу имени и e-mail.
 */
export const AI_CHECK_SOURCE_SELECT = {
  id: true,
  locale: true,
  title: true,
  dek: true,
  article: {
    select: {
      coverAssetId: true,
      section: { select: { slug: true } },
      // Порядок тегов в связке многие-ко-многим не хранится (`ArticleToTag` без позиции),
      // поэтому выборка упорядочена по времени создания тега — `[ДОПУЩЕНИЕ]` до появления
      // позиции у связи. «Первый — главный» (журнал §21.22) этим ещё не обеспечивается.
      tags: { select: { slug: true }, orderBy: { createdAt: "asc" } }
    }
  }
} satisfies Prisma.ArticleTranslationSelect

/** Поля ревизии: тело документа и его заголовок на момент подачи. */
export const AI_CHECK_REVISION_SELECT = {
  id: true,
  title: true,
  dek: true,
  body: true
} satisfies Prisma.ArticleRevisionSelect

const AI_CHECK_MEDIA_SELECT = {
  id: true,
  alt: true,
  caption: true,
  attribution: true,
  license: true,
  licenseNote: true
} satisfies Prisma.MediaAssetSelect

type SourceTranslation = Prisma.ArticleTranslationGetPayload<{ select: typeof AI_CHECK_SOURCE_SELECT }>
type SourceRevision = Prisma.ArticleRevisionGetPayload<{ select: typeof AI_CHECK_REVISION_SELECT }>
type SourceMedia = Prisma.MediaAssetGetPayload<{ select: typeof AI_CHECK_MEDIA_SELECT }>

/** Сырые данные подачи, прочитанные из базы. Автора среди них нет. */
export interface AiCheckSource {
  translation: SourceTranslation
  revision: SourceRevision
  media: readonly SourceMedia[]
}

export class AiCheckSourceMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AiCheckSourceMissingError"
  }
}

export interface LoadAiCheckSourceInput {
  translationId: string
  revisionId: string
}

/**
 * Читает версию, её ревизию и медиафайлы изображений. Ревизия проверяется на принадлежность
 * версии: задание очереди не должно уметь подставить чужую ревизию.
 */
export async function loadAiCheckSource(
  store: AiCheckSubmissionStore,
  input: LoadAiCheckSourceInput
): Promise<AiCheckSource> {
  const translation = await store.articleTranslation.findUnique({
    where: { id: input.translationId },
    select: AI_CHECK_SOURCE_SELECT
  })
  if (!translation) throw new AiCheckSourceMissingError("Article translation not found")

  const revision = await store.articleRevision.findFirst({
    where: { id: input.revisionId, translationId: input.translationId },
    select: AI_CHECK_REVISION_SELECT
  })
  if (!revision) throw new AiCheckSourceMissingError("Article revision not found for this translation")

  const assetIds = collectAssetIds(translation.article.coverAssetId, revision.body)
  const media =
    assetIds.length === 0
      ? []
      : await store.mediaAsset.findMany({ where: { id: { in: assetIds } }, select: AI_CHECK_MEDIA_SELECT })

  return { translation, revision, media }
}

/** Идентификаторы изображений подачи: сначала обложка, затем изображения документа по порядку. */
function collectAssetIds(coverAssetId: string | null, body: Prisma.JsonValue): string[] {
  const ids: string[] = []
  if (coverAssetId) ids.push(coverAssetId)
  for (const image of extractImages(readDocument(body))) {
    if (!ids.includes(image.assetId)) ids.push(image.assetId)
  }
  return ids
}

/**
 * Собирает подачу. Функция чистая: всё, что уходит провайдеру, видно здесь целиком.
 * Порядок изображений — обложка первой, затем изображения документа (журнал §43 п. 1).
 */
export function buildAiCheckSubmission(source: AiCheckSource): AiCheckSubmission {
  const document = readDocument(source.revision.body)
  const byId = new Map(source.media.map((asset) => [asset.id, asset]))
  const coverAssetId = source.translation.article.coverAssetId
  const images: AiCheckImage[] = []

  for (const assetId of collectAssetIds(coverAssetId, source.revision.body)) {
    const asset = byId.get(assetId)
    if (!asset) continue
    images.push({
      assetId: asset.id,
      role: assetId === coverAssetId ? "cover" : "body",
      alt: asset.alt,
      caption: asset.caption,
      attribution: asset.attribution,
      license: asset.license,
      licenseNote: asset.licenseNote
    })
  }

  return {
    translationId: source.translation.id,
    revisionId: source.revision.id,
    locale: source.translation.locale,
    title: source.revision.title,
    dek: source.revision.dek,
    blocks: toPlainText(document),
    sectionSlug: source.translation.article.section?.slug ?? null,
    tags: source.translation.article.tags.map((tag) => tag.slug),
    images,
    // Пометки 18+ у версии в базе пока нет: её вводит T-136. До неё автор пометку не ставит,
    // поэтому подача уходит без неё, а не с придуманным значением.
    adultMarkedByAuthor: false
  }
}
