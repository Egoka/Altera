import type { LegalText, LegalTextKind, LegalTextStatus, Locale, Prisma, Role } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import { ensureAuthenticated, ensurePermission, ensureRole } from "../exceptions/permissions"
import type { GraphQLContext } from "../prisma"
import {
  assertSafeLegalHtml,
  extractLegalAnchors,
  LEGAL_LOCALES,
  legalCacheTag,
  type LegalAnchor
} from "../legal/texts"

/**
 * Раздел админки «Юридические тексты» (`docs/spec/40-admin/legal-texts.md`, ADR-0028).
 *
 * Раздел хранит и публикует версии, не сочиняет их. Читает `admin` и `owner`, черновик и
 * публикацию делает только `owner` (матрица #96, `perm(owner)`). Опубликованная версия не
 * правится и не удаляется: история согласий ссылается на неё (§5 «Что здесь нельзя»).
 *
 * У вида и локали не больше одного черновика, и его номер следует за последней опубликованной
 * редакцией: публикация лишь меняет статус, номер при этом не пропускается.
 */

export const ADMIN_LEGAL_KINDS: readonly LegalTextKind[] = [
  "terms",
  "privacy",
  "content_rules",
  "license",
  "paid_services",
  "refunds",
  "about"
]

/** Виды, согласие с которыми фиксируется при регистрации и входе (`session-lifecycle.md` п. 9). */
const CONSENT_KINDS: readonly LegalTextKind[] = ["terms", "privacy"]

const VISIBLE_STATUSES: LegalTextStatus[] = ["published", "previous"]

export interface AdminLegalLocaleState {
  locale: Locale
  currentVersion: number | null
  publishedAt: Date | null
  draftVersion: number | null
  /** Только для видов с согласием: активные аккаунты локали и принявшие актуальную редакцию. */
  usersTotal: number | null
  usersWithCurrentConsent: number | null
}

export interface AdminLegalKindState {
  kind: LegalTextKind
  requiresConsent: boolean
  locales: AdminLegalLocaleState[]
}

export type AdminLegalVersionRow = Pick<
  LegalText,
  | "id"
  | "kind"
  | "locale"
  | "version"
  | "status"
  | "isMaterial"
  | "summaryOfChanges"
  | "publishedAt"
  | "publishedByRole"
  | "createdAt"
  | "updatedAt"
> & { consentCount: number }

export interface AdminLegalVersionDetail extends AdminLegalVersionRow {
  body: string
  anchors: LegalAnchor[]
  /** Действующая редакция той же локали — основа сравнения; `null`, если это она или её нет. */
  current: { version: number; body: string } | null
  requiresConsent: boolean
  /** Сколько аккаунтов попросит согласия публикация существенной версии; `null` — вид без согласия. */
  affectedUsers: number | null
  /** Для действующей редакции вида с согласием: сколько аккаунтов ещё не приняли актуальную. */
  pendingConsentCount: number | null
}

export interface AdminLegalVersionFilter {
  kind?: LegalTextKind | null
  locale?: Locale | null
  status?: LegalTextStatus | null
}

export interface CreateLegalDraftInput {
  kind: LegalTextKind
  locale: Locale
  body: string
  summaryOfChanges: string
  /** `updatedAt` черновика, который правит `owner`; пусто — создаётся новый черновик. */
  draftUpdatedAt?: string | null
}

export interface PublishLegalDraftInput {
  kind: LegalTextKind
  locale: Locale
  version: number
  isMaterial: boolean
  draftUpdatedAt: string
}

type LegalTx = Prisma.TransactionClient

const rowSelect = {
  id: true,
  kind: true,
  locale: true,
  version: true,
  status: true,
  isMaterial: true,
  summaryOfChanges: true,
  publishedAt: true,
  publishedByRole: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { consents: true } }
} as const

type SelectedRow = Omit<AdminLegalVersionRow, "consentCount"> & { _count: { consents: number } }

const toRow = ({ _count, ...row }: SelectedRow): AdminLegalVersionRow => ({ ...row, consentCount: _count.consents })

function ensureReader(ctx: GraphQLContext) {
  ensureRole(ctx.currentUser, "admin", "legal.read", ctx.requestId)
  return ensureAuthenticated(ctx.currentUser, ctx.requestId)
}

function ensureOwner(ctx: GraphQLContext) {
  ensurePermission(ctx.currentUser, "owner", "legal.update", ctx.requestId)
  return ensureAuthenticated(ctx.currentUser, ctx.requestId)
}

const activeAccounts = (locale: Locale): Prisma.UserWhereInput => ({
  locale,
  archivedAt: null,
  isServiceAccount: false
})

/**
 * Согласие актуально, если принята редакция не старше последней существенной (то же правило, что
 * `readConsentStates`): несущественная правка действует без нового согласия.
 */
async function consentCounts(
  prisma: GraphQLContext["prisma"],
  kind: LegalTextKind,
  locale: Locale
): Promise<{ usersTotal: number; usersWithCurrentConsent: number }> {
  const lastMaterial = await prisma.legalText.findFirst({
    where: { kind, locale, isMaterial: true, status: { in: VISIBLE_STATUSES } },
    orderBy: { version: "desc" },
    select: { version: true }
  })
  const [usersTotal, usersWithCurrentConsent] = await Promise.all([
    prisma.user.count({ where: activeAccounts(locale) }),
    prisma.user.count({
      where: {
        ...activeAccounts(locale),
        legalConsents: {
          some: {
            legalText: { kind, locale, status: { in: VISIBLE_STATUSES }, version: { gte: lastMaterial?.version ?? 1 } }
          }
        }
      }
    })
  ])
  return { usersTotal, usersWithCurrentConsent }
}

export async function listAdminLegalKinds(ctx: GraphQLContext): Promise<AdminLegalKindState[]> {
  ensureReader(ctx)
  const texts = await ctx.prisma.legalText.findMany({
    where: { status: { in: ["published", "draft"] } },
    select: { kind: true, locale: true, version: true, status: true, publishedAt: true }
  })

  return Promise.all(
    ADMIN_LEGAL_KINDS.map(async (kind) => {
      const requiresConsent = CONSENT_KINDS.includes(kind)
      const locales = await Promise.all(
        LEGAL_LOCALES.map(async (locale): Promise<AdminLegalLocaleState> => {
          const ofLocale = texts.filter((text) => text.kind === kind && text.locale === locale)
          const current = ofLocale.find((text) => text.status === "published")
          const draft = ofLocale.find((text) => text.status === "draft")
          const counts = requiresConsent && current ? await consentCounts(ctx.prisma, kind, locale) : null
          return {
            locale,
            currentVersion: current?.version ?? null,
            publishedAt: current?.publishedAt ?? null,
            draftVersion: draft?.version ?? null,
            usersTotal: counts?.usersTotal ?? null,
            usersWithCurrentConsent: counts?.usersWithCurrentConsent ?? null
          }
        })
      )
      return { kind, requiresConsent, locales }
    })
  )
}

/** Список версий: вид по порядку реестра, внутри — номер по убыванию (§4). */
export async function listAdminLegalVersions(
  ctx: GraphQLContext,
  filter: AdminLegalVersionFilter = {}
): Promise<AdminLegalVersionRow[]> {
  ensureReader(ctx)
  const rows = await ctx.prisma.legalText.findMany({
    where: {
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(filter.locale ? { locale: filter.locale } : {}),
      ...(filter.status ? { status: filter.status } : {})
    },
    orderBy: [{ kind: "asc" }, { version: "desc" }],
    select: rowSelect
  })
  return rows.map(toRow)
}

export async function getAdminLegalVersion(
  ctx: GraphQLContext,
  input: { kind: LegalTextKind; locale: Locale; version: number }
): Promise<AdminLegalVersionDetail | null> {
  ensureReader(ctx)
  const text = await ctx.prisma.legalText.findUnique({
    where: { kind_locale_version: input },
    select: { ...rowSelect, body: true }
  })
  if (!text) return null

  const { body, ...selected } = text
  const current =
    text.status === "published"
      ? null
      : await ctx.prisma.legalText.findFirst({
          where: { kind: input.kind, locale: input.locale, status: "published" },
          select: { version: true, body: true }
        })
  const requiresConsent = CONSENT_KINDS.includes(input.kind)
  const counts = requiresConsent ? await consentCounts(ctx.prisma, input.kind, input.locale) : null

  return {
    ...toRow(selected),
    body,
    anchors: extractLegalAnchors(body),
    current,
    requiresConsent,
    affectedUsers: counts?.usersTotal ?? null,
    pendingConsentCount:
      counts && text.status === "published" ? counts.usersTotal - counts.usersWithCurrentConsent : null
  }
}

function requiredText(value: string, field: string, requestId: string): string {
  const normalized = value.trim()
  if (!normalized) throw createApiError("VALIDATION_ERROR", { requestId, field, rule: "required" })
  return normalized
}

function safeBody(body: string, requestId: string): string {
  requiredText(body, "body", requestId)
  try {
    assertSafeLegalHtml(body)
  } catch {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "body", rule: "static-html" })
  }
  return body
}

const conflict = (requestId: string, expected: string, actual: string) =>
  createApiError("CONFLICT", { requestId, entity: "legalText", expected, actual })

async function nextVersion(tx: LegalTx, kind: LegalTextKind, locale: Locale): Promise<number> {
  const latest = await tx.legalText.findFirst({
    where: { kind, locale, status: { not: "draft" } },
    orderBy: { version: "desc" },
    select: { version: true }
  })
  return (latest?.version ?? 0) + 1
}

/**
 * Черновик создаётся или правится (§5 «Создать черновик версии»). Правка сверяет `updatedAt`:
 * если другой `owner` успел изменить или опубликовать черновик, ответ — `CONFLICT` (§9).
 */
export async function createLegalDraft(
  ctx: GraphQLContext,
  input: CreateLegalDraftInput
): Promise<AdminLegalVersionRow> {
  const actor = ensureOwner(ctx)
  const body = safeBody(input.body, ctx.requestId)
  const summaryOfChanges = requiredText(input.summaryOfChanges, "summaryOfChanges", ctx.requestId)

  return ctx.prisma.$transaction(async (tx) => {
    const existing = await tx.legalText.findFirst({
      where: { kind: input.kind, locale: input.locale, status: "draft" },
      select: { id: true, updatedAt: true }
    })
    if (existing && input.draftUpdatedAt !== existing.updatedAt.toISOString()) {
      throw conflict(ctx.requestId, input.draftUpdatedAt ?? "new-draft", existing.updatedAt.toISOString())
    }
    if (!existing && input.draftUpdatedAt) throw conflict(ctx.requestId, "draft", "missing")

    const saved = existing
      ? await tx.legalText.update({ where: { id: existing.id }, data: { body, summaryOfChanges }, select: rowSelect })
      : await tx.legalText.create({
          data: {
            kind: input.kind,
            locale: input.locale,
            version: await nextVersion(tx, input.kind, input.locale),
            status: "draft",
            body,
            summaryOfChanges
          },
          select: rowSelect
        })

    // Аудит хранит номер и описание; полный текст остаётся в самой версии (§8).
    await tx.auditLog.create({
      data: {
        action: "legal.update",
        actorId: actor.id,
        actorRole: actor.role as Role,
        entityType: "legalText",
        entityId: saved.id,
        diff: {
          kind: saved.kind,
          locale: saved.locale,
          version: saved.version,
          stage: "draft",
          summaryOfChanges,
          fields: existing ? { body: { changed: true } } : { status: { from: null, to: "draft" } }
        },
        requestId: ctx.requestId
      }
    })
    return toRow(saved)
  })
}

/**
 * Публикация черновика (§5 «Опубликовать версию»): действующая редакция уходит в прежние,
 * черновик получает следующий номер и статус `published`. Существенная версия требует повторного
 * согласия при следующем входе — это решает `readConsentStates` по признаку `isMaterial`.
 */
export async function publishLegalDraft(
  ctx: GraphQLContext,
  input: PublishLegalDraftInput,
  now = new Date()
): Promise<AdminLegalVersionRow> {
  const actor = ensureOwner(ctx)

  const published = await ctx.prisma.$transaction(async (tx) => {
    const draft = await tx.legalText.findUnique({
      where: { kind_locale_version: { kind: input.kind, locale: input.locale, version: input.version } },
      select: { id: true, status: true, body: true, summaryOfChanges: true, updatedAt: true }
    })
    if (!draft) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "legalText" })
    if (draft.status !== "draft") throw conflict(ctx.requestId, "draft", draft.status)
    if (draft.updatedAt.toISOString() !== input.draftUpdatedAt) {
      throw conflict(ctx.requestId, input.draftUpdatedAt, draft.updatedAt.toISOString())
    }
    safeBody(draft.body, ctx.requestId)
    requiredText(draft.summaryOfChanges, "summaryOfChanges", ctx.requestId)

    const version = await nextVersion(tx, input.kind, input.locale)
    await tx.legalText.updateMany({
      where: { kind: input.kind, locale: input.locale, status: "published" },
      data: { status: "previous" }
    })
    const saved = await tx.legalText.update({
      where: { id: draft.id },
      data: {
        status: "published",
        version,
        isMaterial: input.isMaterial,
        publishedAt: now,
        publishedByActorId: actor.id,
        publishedByRole: actor.role as Role
      },
      select: rowSelect
    })

    await tx.auditLog.create({
      data: {
        action: "legal.update",
        actorId: actor.id,
        actorRole: actor.role as Role,
        entityType: "legalText",
        entityId: saved.id,
        diff: {
          kind: saved.kind,
          locale: saved.locale,
          version: saved.version,
          stage: "published",
          isMaterial: input.isMaterial,
          summaryOfChanges: saved.summaryOfChanges,
          fields: { status: { from: "draft", to: "published" } }
        },
        requestId: ctx.requestId
      }
    })
    return saved
  })

  // Публичная страница и карта сайта (тег `home`) кешируются: новая версия действует сразу.
  await ctx.cache.delByTags([legalCacheTag(input.kind), "home"])
  return toRow(published)
}
