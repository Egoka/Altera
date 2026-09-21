import type { LegalText, LegalTextKind, Locale, PrismaClient } from "../generated/prisma"

/**
 * Версии публичных юридических текстов (ADR-0028; `docs/spec/20-public/legal-*.md` §4).
 *
 * Версия, однажды опубликованная, не правится и не удаляется: новая редакция получает
 * следующий номер, а прежняя действующая переходит в статус `previous` и остаётся доступной по
 * `?version=N` (`docs/spec/40-admin/legal-texts.md` §4). Признак существенности решает, требует
 * ли редакция повторного согласия при следующем входе (`session-lifecycle.md` п. 9).
 */

/** Виды текстов со страницами `/legal/*` этой задачи; платные услуги и возвраты — F-01. */
export const PUBLIC_LEGAL_KINDS = ["terms", "privacy", "content_rules", "license"] as const
export type PublicLegalKind = (typeof PUBLIC_LEGAL_KINDS)[number]

export const LEGAL_LOCALES: readonly Locale[] = ["ru", "en"]

/** Публичный адрес страницы вида: `content_rules` живёт по адресу с дефисом (`routes.md` #18). */
export const legalPath = (kind: PublicLegalKind): string => `/legal/${kind.replace("_", "-")}`

/** Тег кеша вида: публикация новой редакции сбрасывает его (`legal.publish`, §4). */
export const legalCacheTag = (kind: LegalTextKind): string => `legal:${kind}`

const VISIBLE_STATUSES = ["published", "previous"] as const

export interface LegalAnchor {
  id: string
  title: string
}

export interface LegalVersionSummary {
  version: number
  publishedAt: string
  isMaterial: boolean
  summaryOfChanges: string
}

export interface LegalDocumentView extends LegalVersionSummary {
  kind: PublicLegalKind
  locale: Locale
  requestedLocale: Locale
  isFallbackLocale: boolean
  isCurrent: boolean
  currentVersion: number
  html: string
  anchors: LegalAnchor[]
  previousVersions: LegalVersionSummary[]
  availableLocales: Locale[]
}

type LegalTextReader = Pick<PrismaClient, "legalText">

const HEADING = /<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi
const ID_ATTRIBUTE = /\bid\s*=\s*["']([^"']+)["']/i

const decodeEntities = (value: string): string =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")

/**
 * Оглавление строится из разделов второго уровня с `id`: те же якоря (`#rights`, `#cookies`,
 * `#ai-training` и другие) адресуют разделы из редактора, писем и уведомлений.
 */
export const extractLegalAnchors = (html: string): LegalAnchor[] => {
  const anchors: LegalAnchor[] = []
  for (const match of html.matchAll(HEADING)) {
    const id = match[1]?.match(ID_ATTRIBUTE)?.[1]
    const title = decodeEntities((match[2] ?? "").replace(/<[^>]*>/g, ""))
      .replace(/\s+/g, " ")
      .trim()
    if (id && title) anchors.push({ id, title })
  }
  return anchors
}

const UNSAFE_MARKUP: readonly [RegExp, string][] = [
  [/<\s*(script|iframe|object|embed|style|link|meta|base|form)\b/i, "active or document-level element"],
  [/\son[a-z]+\s*=/i, "inline event handler"],
  [/(href|src)\s*=\s*["']?\s*(javascript|data|vbscript):/i, "script URL"]
]

/**
 * Текст публикуется релизом кода или владельцем и выводится страницей как HTML. Автор текста
 * доверенный, но проверка оставляет в разметке только статическое содержимое: без неё одна
 * ошибка копирования превратила бы публичную страницу в исполняемый код.
 */
export const assertSafeLegalHtml = (html: string): void => {
  if (!html.trim()) throw new Error("Legal text body is empty")
  for (const [pattern, reason] of UNSAFE_MARKUP) {
    if (pattern.test(html)) throw new Error(`Legal text body contains ${reason}`)
  }
}

const iso = (date: Date | null): string => (date ?? new Date(0)).toISOString()

const summaryOf = (
  text: Pick<LegalText, "version" | "publishedAt" | "isMaterial" | "summaryOfChanges">
): LegalVersionSummary => ({
  version: text.version,
  publishedAt: iso(text.publishedAt),
  isMaterial: text.isMaterial,
  summaryOfChanges: text.summaryOfChanges
})

export class LegalVersionNotFound extends Error {
  constructor() {
    super("Legal text version not found")
  }
}

/**
 * Публичный текст вида для локали страницы.
 *
 * Если в локали текст ещё не опубликован, показывается другая локаль с пометкой (строка «Пусто»
 * §8). `null` — ни одной опубликованной версии нет ни в одной локали: страница показывает
 * состояние «документ готовится». Неизвестная версия — `LegalVersionNotFound` (404 по §8).
 */
export async function readPublicLegalText(
  prisma: LegalTextReader,
  input: { kind: PublicLegalKind; locale: Locale; version?: number | null }
): Promise<LegalDocumentView | null> {
  const versions = await prisma.legalText.findMany({
    where: { kind: input.kind, status: { in: [...VISIBLE_STATUSES] } },
    orderBy: { version: "desc" },
    select: {
      id: true,
      locale: true,
      version: true,
      status: true,
      publishedAt: true,
      isMaterial: true,
      summaryOfChanges: true
    }
  })

  const availableLocales = LEGAL_LOCALES.filter((locale) =>
    versions.some((text) => text.locale === locale && text.status === "published")
  )
  const locale = availableLocales.includes(input.locale) ? input.locale : availableLocales[0]
  if (!locale) {
    if (input.version !== undefined && input.version !== null) throw new LegalVersionNotFound()
    return null
  }

  const ofLocale = versions.filter((text) => text.locale === locale)
  const current = ofLocale.find((text) => text.status === "published")!
  const wanted =
    input.version === undefined || input.version === null
      ? current
      : ofLocale.find((text) => text.version === input.version)
  if (!wanted) throw new LegalVersionNotFound()

  const body = await prisma.legalText.findUnique({ where: { id: wanted.id }, select: { body: true } })
  const html = body?.body ?? ""

  return {
    kind: input.kind,
    locale,
    requestedLocale: input.locale,
    isFallbackLocale: locale !== input.locale,
    ...summaryOf(wanted),
    isCurrent: wanted.id === current.id,
    currentVersion: current.version,
    html,
    anchors: extractLegalAnchors(html),
    previousVersions: ofLocale.filter((text) => text.id !== current.id).map(summaryOf),
    availableLocales
  }
}

export interface PublishLegalVersionInput {
  kind: LegalTextKind
  locale: Locale
  body: string
  summaryOfChanges: string
  isMaterial: boolean
  publishedAt?: Date
  publishedByActorId?: string | null
}

/**
 * Публикация новой редакции: следующий номер вида и локали, прежняя действующая — в `previous`.
 * Так публикует релиз кода через `legal:publish`; раздел `/admin/legal` публикует черновик
 * (`src/admin/legal.ts`) по тому же правилу номеров.
 */
export async function publishLegalVersion(
  prisma: Pick<PrismaClient, "$transaction">,
  input: PublishLegalVersionInput
): Promise<LegalText> {
  assertSafeLegalHtml(input.body)
  if (!input.summaryOfChanges.trim()) throw new Error("Summary of changes is required")

  return prisma.$transaction(async (tx) => {
    const latest = await tx.legalText.findFirst({
      where: { kind: input.kind, locale: input.locale, status: { not: "draft" } },
      orderBy: { version: "desc" },
      select: { version: true }
    })
    const version = (latest?.version ?? 0) + 1

    await tx.legalText.updateMany({
      where: { kind: input.kind, locale: input.locale, status: "published" },
      data: { status: "previous" }
    })
    // Черновик раздела `/admin/legal` всегда следует за последней опубликованной редакцией:
    // публикация релизом кода занимает его номер, и черновик сдвигается на следующий.
    await tx.legalText.updateMany({
      where: { kind: input.kind, locale: input.locale, status: "draft" },
      data: { version: version + 1 }
    })

    return tx.legalText.create({
      data: {
        kind: input.kind,
        locale: input.locale,
        version,
        status: "published",
        body: input.body,
        summaryOfChanges: input.summaryOfChanges.trim(),
        isMaterial: input.isMaterial,
        publishedAt: input.publishedAt ?? new Date(),
        publishedByActorId: input.publishedByActorId ?? null
      }
    })
  })
}
