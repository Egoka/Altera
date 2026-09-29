import { Prisma, type AccountArchiveMode, type AccountArchiveReasonCategory, type Role } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import { ensureAuthenticated, ensureRole } from "../exceptions/permissions"
import { authorCacheTag, buildArticleCacheTags } from "../cache/key"
import { deriveAccountSubscription, type AccountSubscriptionView } from "../account/dashboard"
import { isBaseGrant } from "../plans/plan-state"
import { listAccountSessions, type AccountSessionStore, type AccountSessionView } from "../auth/account-sessions"
import { calculatePagination, validatePagination, type PaginationInfo, type PaginationInput } from "../utils/admin"
import { maskEmail } from "./personal-data"
import type { GraphQLContext } from "../prisma"

/**
 * Раздел админки «Пользователи» (`docs/spec/40-admin/users.md`) и flow #11
 * (`docs/spec/10-flows/archive-account.md`): список обычных аккаунтов маской, карточка с полным
 * адресом и записью чтения ПДн, блокировка как архивирование с каскадом статей, экстренная
 * блокировка, восстановление без возврата статей, отзыв сессий и смена адреса сотрудником.
 *
 * Служебные записи здесь не показываются и по `id` отвечают 404 (журнал §25.2, §2 спецификации) —
 * ими занимается `admin/staff.ts`. Оспаривание (T-061) и «удалить навсегда» (T-076) в раздел
 * добавляются своими задачами: здесь их нет ни в выдаче, ни в мутациях.
 */

/** Чтение раздела — `analyst`, `admin`, `owner` (матрица #81); `editor` и `moderator` — 403. */
const READ_ROLES: readonly Role[] = ["analyst", "admin", "owner"]

/** Роли обычных аккаунтов: читатель и автор (§1). */
const PERSONAL_ROLES: readonly Role[] = ["reader", "author"]

/** Поиск включается от трёх знаков (§4): более короткая строка фильтром не считается. */
export const USERS_SEARCH_MIN_LENGTH = 3

/** Размер страницы списка по умолчанию — 20, максимум 100 (§4). */
export const USERS_PAGE_SIZE = 20

const ACTIVE_ARTICLE_STATUS = { not: "archived" } as const

export type AdminUserStatus = "active" | "archived"
export type AdminUserPlanFilter = "free" | "standard" | "pro" | "grant" | "expired"
export type AdminUserSort = "registered" | "lastActive" | "name" | "publications"

export interface AdminUserFilters {
  role?: Role | null
  status?: AdminUserStatus | null
  archiveMode?: AccountArchiveMode | null
  plan?: AdminUserPlanFilter | null
  registeredFrom?: string | null
  registeredTo?: string | null
  lastActiveFrom?: string | null
  hasPublications?: boolean | null
  search?: string | null
  sort?: AdminUserSort | null
}

export interface AdminUserRow {
  id: string
  name: string
  handle: string
  /** Список показывает маску: полный адрес открывает только карточка, с записью аудита (§28.7). */
  email: string
  emailMasked: boolean
  role: Role
  status: AdminUserStatus
  archiveMode: AccountArchiveMode | null
  plan: AccountSubscriptionView
  createdAt: Date
  lastActiveAt: Date | null
  articlesCount: number
  publishedCount: number
}

export interface AdminUserList {
  items: AdminUserRow[]
  pagination: PaginationInfo
  /** Роль зрителя: карточка и список по ней скрывают кнопки и вкладку сессий (§9). */
  viewerRole: Role
  viewerCanManage: boolean
}

export interface AdminUserArticleRow {
  id: string
  slug: string
  title: string
  status: string
  locale: string
  createdAt: Date
  publishedAt: Date | null
  archivedAt: Date | null
  /** Статью архивировал сотрудник: автор такую не восстанавливает (журнал §4.2–4). */
  archivedByStaff: boolean
}

export interface AdminUserArticleStats {
  total: number
  draft: number
  review: number
  published: number
  archived: number
}

export interface AdminUserConsent {
  kind: string
  version: number
  locale: string
  acceptedAt: Date
}

export interface AdminUserBaseAuthorship {
  /** Базовые авторские возможности открыты (§25.1, §27.1; событие `author.enabled` #87). */
  enabled: boolean
  /** Дата первого «Создать статью»; `null` — базовой выдачи не было. */
  enabledAt: Date | null
}

export interface AdminUserAppeal {
  id: string
  message: string
  status: "submitted" | "restored" | "confirmed"
  submittedAt: Date
  decidedAt: Date | null
  decidedByRole: Role | null
  decisionReason: string | null
}

export interface AdminUserCard extends AdminUserRow {
  locale: string
  nameCheckStatus: string
  avatarCheckStatus: string
  archivedAt: Date | null
  archiveReasonCategory: AccountArchiveReasonCategory | null
  archivePublicMessage: string | null
  /**
   * Внутренняя причина: пользователю она не показывается нигде (§26.9). Аналитику тоже не
   * отдаётся — коды `user.archive` и `user.restore` закрыты для служебных зон (журнал #39),
   * поэтому иначе карточка обошла бы это ограничение.
   */
  archiveInternalReason: string | null
  archivedByName: string | null
  archivedByRole: Role | null
  baseAuthorship: AdminUserBaseAuthorship
  articleStats: AdminUserArticleStats
  articles: AdminUserArticleRow[]
  consents: AdminUserConsent[]
  /** Сессии — зона безопасности: `analyst` вкладку не видит и получает `null` (журнал §26.6). */
  sessions: AccountSessionView[] | null
  /** Текст обращения и решение видят только `admin`/`owner`; analyst получает `null`. */
  appeal: AdminUserAppeal | null
  canDecideAppeal: boolean
  canArchive: boolean
  canRestore: boolean
  canRevokeSessions: boolean
  canChangeEmail: boolean
}

export interface ArchiveAccountInput {
  id: string
  reasonCategory: AccountArchiveReasonCategory
  publicMessage?: string | null
  internalReason: string
  mode?: AccountArchiveMode | null
}

export interface RevokeUserSessionsResult {
  revokedCount: number
}

export interface AdminEmailChangeResult {
  /** Новый адрес маской: подтверждение действия не обязано ещё раз раскрывать ПДн. */
  emailMasked: string
  changedAt: Date
}

interface Viewer {
  id: string
  role: Role
  canManage: boolean
  canSeeSessions: boolean
}

const userSelect = {
  id: true,
  name: true,
  handle: true,
  email: true,
  role: true,
  locale: true,
  nameCheckStatus: true,
  avatarCheckStatus: true,
  createdAt: true,
  archivedAt: true,
  archiveMode: true,
  archiveReason: true,
  archiveReasonCategory: true,
  archivePublicMessage: true,
  archivedByActorId: true,
  archivedByRole: true,
  planTier: true,
  planUntil: true,
  accountAppeal: {
    select: {
      id: true,
      message: true,
      status: true,
      submittedAt: true,
      decidedAt: true,
      decidedByRole: true,
      decisionReason: true
    }
  }
} as const satisfies Prisma.UserSelect

type UserRecord = Prisma.UserGetPayload<{ select: typeof userSelect }>

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Чтение раздела: право `accounts` тут не годится — оно закрыто для `analyst` (матрица #81). */
function ensureViewer(ctx: GraphQLContext, action: string): Viewer {
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  if (user.archivedAt || !READ_ROLES.includes(user.role)) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action })
  }
  const canManage = user.role === "admin" || user.role === "owner"
  return { id: user.id, role: user.role, canManage, canSeeSessions: canManage }
}

/** Мутации раздела — `role(admin)`: `admin` и `owner` (матрица #52, #80, #105, #113). */
function ensureManager(ctx: GraphQLContext, action: string): Viewer {
  ensureRole(ctx.currentUser, "admin", action, ctx.requestId)
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  return { id: user.id, role: user.role, canManage: true, canSeeSessions: true }
}

function requiredText(value: string | null | undefined, field: string, requestId: string): string {
  const normalized = (value ?? "").trim()
  if (!normalized) throw createApiError("VALIDATION_ERROR", { requestId, field, rule: "required" })
  return normalized
}

function parseDate(value: string, field: string, requestId: string): Date {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw createApiError("VALIDATION_ERROR", { requestId, field, rule: "iso-date" })
  }
  return parsed
}

const statusOf = (record: Pick<UserRecord, "archivedAt">): AdminUserStatus =>
  record.archivedAt ? "archived" : "active"

/**
 * Фильтр плана идёт по кэшу `planTier`/`planUntil` записи (`role-derivation.md` п. 1, 9), а не по
 * выдачам: иначе страницу нельзя было бы отобрать в самой базе, а пагинация считала бы не то,
 * что показывает. Состояние в строке при этом выводится из самих выдач — кэш хранит уровень, а
 * не очередь периодов.
 */
function planWhere(plan: AdminUserPlanFilter, now: Date): Prisma.UserWhereInput {
  if (plan === "free") return { planTier: "free", planGrants: { none: {} } }
  if (plan === "standard" || plan === "pro") return { planTier: plan }
  if (plan === "grant") {
    return {
      planGrants: {
        some: {
          revokedAt: null,
          grantedById: { not: null },
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }]
        }
      }
    }
  }
  // «Истёк»: действующего уровня нет, но выдача когда-то была (plan-free.md п. 3–4).
  return { planTier: "free", planGrants: { some: { OR: [{ endsAt: { lte: now } }, { revokedAt: { not: null } }] } } }
}

function buildWhere(ctx: GraphQLContext, filters: AdminUserFilters, now: Date): Prisma.UserWhereInput {
  const status = filters.status ?? "active"
  const search = filters.search?.trim() ?? ""
  const conditions: Prisma.UserWhereInput[] = [
    { isServiceAccount: false, role: { in: [...PERSONAL_ROLES] } },
    status === "archived" ? { archivedAt: { not: null } } : { archivedAt: null }
  ]

  if (filters.role) conditions.push({ role: filters.role })
  if (filters.archiveMode) conditions.push({ archiveMode: filters.archiveMode })
  if (filters.plan) conditions.push(planWhere(filters.plan, now))
  if (filters.registeredFrom) {
    conditions.push({ createdAt: { gte: parseDate(filters.registeredFrom, "registeredFrom", ctx.requestId) } })
  }
  if (filters.registeredTo) {
    conditions.push({ createdAt: { lte: parseDate(filters.registeredTo, "registeredTo", ctx.requestId) } })
  }
  if (filters.lastActiveFrom) {
    const from = parseDate(filters.lastActiveFrom, "lastActiveFrom", ctx.requestId)
    conditions.push({ sessions: { some: { lastUsedAt: { gte: from } } } })
  }
  if (filters.hasPublications === true) conditions.push({ articles: { some: { status: "published" } } })
  if (filters.hasPublications === false) conditions.push({ articles: { none: { status: "published" } } })
  if (search.length >= USERS_SEARCH_MIN_LENGTH) {
    conditions.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { handle: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } }
      ]
    })
  }

  return { AND: conditions }
}

function orderBy(sort: AdminUserSort): Prisma.UserOrderByWithRelationInput[] {
  if (sort === "name") return [{ name: "asc" }, { id: "asc" }]
  if (sort === "publications") return [{ articles: { _count: "desc" } }, { id: "asc" }]
  return [{ createdAt: "desc" }, { id: "desc" }]
}

/**
 * Последняя активность выводится из самой свежей сессии, как в разделе служебных записей:
 * отдельной колонки у аккаунта нет, а IP и сырой `user-agent` наружу не уходят (журнал §25.9).
 */
async function lastActiveByUser(ctx: GraphQLContext, ids: string[]): Promise<Map<string, Date>> {
  if (ids.length === 0) return new Map()
  const grouped = await ctx.prisma.session.groupBy({
    by: ["userId"],
    where: { userId: { in: ids } },
    _max: { lastUsedAt: true }
  })
  return new Map(grouped.flatMap((row) => (row._max.lastUsedAt ? [[row.userId, row._max.lastUsedAt] as const] : [])))
}

async function articleCountsByUser(
  ctx: GraphQLContext,
  ids: string[]
): Promise<Map<string, { total: number; published: number }>> {
  if (ids.length === 0) return new Map()
  const grouped = await ctx.prisma.article.groupBy({
    by: ["authorId", "status"],
    where: { authorId: { in: ids } },
    _count: { _all: true }
  })
  const counts = new Map<string, { total: number; published: number }>()
  for (const row of grouped) {
    const current = counts.get(row.authorId) ?? { total: 0, published: 0 }
    current.total += row._count._all
    if (row.status === "published") current.published += row._count._all
    counts.set(row.authorId, current)
  }
  return counts
}

async function plansByUser(
  ctx: GraphQLContext,
  ids: string[],
  now: Date
): Promise<Map<string, AccountSubscriptionView>> {
  if (ids.length === 0) return new Map()
  const grants = await ctx.prisma.planGrant.findMany({
    where: { userId: { in: ids } },
    select: { userId: true, tier: true, startsAt: true, endsAt: true, revokedAt: true }
  })
  const byUser = new Map<
    string,
    Array<{ tier: "free" | "standard" | "pro"; startsAt: Date; endsAt: Date | null; revokedAt: Date | null }>
  >()
  for (const grant of grants) {
    const list = byUser.get(grant.userId) ?? []
    list.push({ tier: grant.tier, startsAt: grant.startsAt, endsAt: grant.endsAt, revokedAt: grant.revokedAt })
    byUser.set(grant.userId, list)
  }
  return new Map(ids.map((id) => [id, deriveAccountSubscription(byUser.get(id) ?? [], now)]))
}

function presentRow(
  record: UserRecord,
  options: {
    revealEmail: boolean
    plan: AccountSubscriptionView
    lastActiveAt: Date | null
    articlesCount: number
    publishedCount: number
  }
): AdminUserRow {
  return {
    id: record.id,
    name: record.name,
    handle: record.handle,
    email: options.revealEmail ? record.email : maskEmail(record.email),
    emailMasked: !options.revealEmail,
    role: record.role,
    status: statusOf(record),
    archiveMode: record.archiveMode,
    plan: options.plan,
    createdAt: record.createdAt,
    lastActiveAt: options.lastActiveAt,
    articlesCount: options.articlesCount,
    publishedCount: options.publishedCount
  }
}

/**
 * Запись чтения персональных данных (#67, журнал §14.4, §28.7). Контекст и цель заполняет
 * система: сотрудник их не вводит и подменить не может.
 */
async function auditPersonalRead(
  ctx: GraphQLContext,
  viewer: Viewer,
  entityId: string,
  purpose: string
): Promise<void> {
  await ctx.prisma.auditLog.create({
    data: {
      action: "admin.read.personal",
      actorId: viewer.id,
      actorRole: viewer.role,
      entityType: "user",
      entityId,
      context: "admin.users",
      purpose,
      requestId: ctx.requestId
    }
  })
}

/**
 * Список раздела (§4). Просмотр списка в аудит не пишется — адрес идёт маской (§8), а вот поиск
 * сверяется с адресом, поэтому запрос с поисковой строкой записывается как чтение ПДн: то же
 * правило уже действует для фильтра получателя в разделе писем.
 */
export async function listAdminUsers(
  ctx: GraphQLContext,
  args: { filters?: AdminUserFilters | null; pagination?: PaginationInput | null },
  now = new Date()
): Promise<AdminUserList> {
  const viewer = ensureViewer(ctx, "admin.users.read")
  const filters = args.filters ?? {}
  const pagination = { page: args.pagination?.page ?? 1, limit: args.pagination?.limit ?? USERS_PAGE_SIZE }
  validatePagination(pagination, ctx.requestId)

  const where = buildWhere(ctx, filters, now)
  const sort = filters.sort ?? "registered"
  const total = await ctx.prisma.user.count({ where })
  const { skip, take, pagination: paginationInfo } = calculatePagination(pagination.page, pagination.limit, total)

  let records: UserRecord[]
  if (sort === "lastActive") {
    // Последняя активность лежит в сессиях, а не в колонке аккаунта: Prisma не умеет
    // сортировать по `MAX` связи, поэтому порядок считается по отобранным записям и только
    // затем режется на страницу. Раздел админки работает с обычными аккаунтами, а не с лентой.
    const matching = await ctx.prisma.user.findMany({ where, select: { id: true, createdAt: true } })
    const lastActive = await lastActiveByUser(
      ctx,
      matching.map(({ id }) => id)
    )
    const ordered = [...matching].sort((left, right) => {
      const leftTime = lastActive.get(left.id)?.getTime() ?? 0
      const rightTime = lastActive.get(right.id)?.getTime() ?? 0
      return rightTime - leftTime || right.createdAt.getTime() - left.createdAt.getTime()
    })
    const pageIds = ordered.slice(skip, skip + take).map(({ id }) => id)
    const loaded = await ctx.prisma.user.findMany({ where: { id: { in: pageIds } }, select: userSelect })
    const byId = new Map(loaded.map((record) => [record.id, record]))
    records = pageIds.flatMap((id) => (byId.get(id) ? [byId.get(id) as UserRecord] : []))
  } else {
    records = await ctx.prisma.user.findMany({ where, skip, take, orderBy: orderBy(sort), select: userSelect })
  }

  const ids = records.map(({ id }) => id)
  const [plans, counts, lastActive] = await Promise.all([
    plansByUser(ctx, ids, now),
    articleCountsByUser(ctx, ids),
    lastActiveByUser(ctx, ids)
  ])

  const search = filters.search?.trim() ?? ""
  if (search.length >= USERS_SEARCH_MIN_LENGTH) {
    // Поиск сверяется с адресом, поэтому он аудируется и при пустом результате (§4, §8).
    await auditPersonalRead(ctx, viewer, ctx.piiHasher.email(search), "admin.users.search")
  }

  return {
    items: records.map((record) =>
      presentRow(record, {
        revealEmail: false,
        plan: plans.get(record.id) ?? deriveAccountSubscription([], now),
        lastActiveAt: lastActive.get(record.id) ?? null,
        articlesCount: counts.get(record.id)?.total ?? 0,
        publishedCount: counts.get(record.id)?.published ?? 0
      })
    ),
    pagination: paginationInfo,
    viewerRole: viewer.role,
    viewerCanManage: viewer.canManage
  }
}

async function readArchivedByName(ctx: GraphQLContext, actorId: string | null): Promise<string | null> {
  if (!actorId) return null
  const actor = await ctx.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } })
  return actor?.name ?? null
}

async function readBaseAuthorship(ctx: GraphQLContext, userId: string): Promise<AdminUserBaseAuthorship> {
  const grants = await ctx.prisma.planGrant.findMany({
    where: { userId },
    select: { startsAt: true, endsAt: true, grantedById: true, revokedAt: true }
  })
  const base = grants.find(isBaseGrant)
  if (!base) return { enabled: false, enabledAt: null }
  return { enabled: base.revokedAt === null, enabledAt: base.startsAt }
}

async function readArticles(
  ctx: GraphQLContext,
  userId: string
): Promise<{ stats: AdminUserArticleStats; rows: AdminUserArticleRow[] }> {
  const articles = await ctx.prisma.article.findMany({
    where: { authorId: userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      sourceLocale: true,
      createdAt: true,
      publishedAt: true,
      archivedAt: true,
      archivedByRole: true
    }
  })

  const stats: AdminUserArticleStats = { total: articles.length, draft: 0, review: 0, published: 0, archived: 0 }
  for (const article of articles) {
    if (article.status === "published") stats.published += 1
    else if (article.status === "archived") stats.archived += 1
    else if (article.status === "draft") stats.draft += 1
    else stats.review += 1
  }

  return {
    stats,
    rows: articles.map((article) => ({
      id: article.id,
      slug: article.slug,
      title: article.title,
      status: article.status,
      locale: article.sourceLocale,
      createdAt: article.createdAt,
      publishedAt: article.publishedAt,
      archivedAt: article.archivedAt,
      archivedByStaff:
        article.archivedByRole !== null && article.archivedByRole !== "author" && article.archivedByRole !== "reader"
    }))
  }
}

async function readConsents(ctx: GraphQLContext, userId: string): Promise<AdminUserConsent[]> {
  const consents = await ctx.prisma.userLegalConsent.findMany({
    where: { userId },
    orderBy: { acceptedAt: "desc" },
    select: { acceptedAt: true, legalText: { select: { kind: true, version: true, locale: true } } }
  })
  return consents.map((consent) => ({
    kind: consent.legalText.kind,
    version: consent.legalText.version,
    locale: consent.legalText.locale,
    acceptedAt: consent.acceptedAt
  }))
}

/**
 * Карточка (§5). Открытие показывает полный адрес, поэтому пишет `admin.read.personal` — это
 * единственное место раздела, где адрес раскрывается.
 */
export async function getAdminUser(ctx: GraphQLContext, id: string, now = new Date()): Promise<AdminUserCard | null> {
  const viewer = ensureViewer(ctx, "admin.user.read")
  const record = await ctx.prisma.user.findUnique({ where: { id }, select: { ...userSelect, isServiceAccount: true } })
  // Служебная запись и неизвестный `id` отвечают одинаково: раздел их не знает (§2).
  if (!record || record.isServiceAccount || !PERSONAL_ROLES.includes(record.role)) return null

  await auditPersonalRead(ctx, viewer, record.id, "admin.user.read")

  const [plans, counts, lastActive, baseAuthorship, articles, consents, archivedByName, sessions] = await Promise.all([
    plansByUser(ctx, [record.id], now),
    articleCountsByUser(ctx, [record.id]),
    lastActiveByUser(ctx, [record.id]),
    readBaseAuthorship(ctx, record.id),
    readArticles(ctx, record.id),
    readConsents(ctx, record.id),
    readArchivedByName(ctx, record.archivedByActorId),
    viewer.canSeeSessions
      ? listAccountSessions(ctx.prisma as unknown as AccountSessionStore, record.id, null, now)
      : Promise.resolve(null)
  ])

  const row = presentRow(record, {
    revealEmail: true,
    plan: plans.get(record.id) ?? deriveAccountSubscription([], now),
    lastActiveAt: lastActive.get(record.id) ?? null,
    articlesCount: counts.get(record.id)?.total ?? 0,
    publishedCount: counts.get(record.id)?.published ?? 0
  })

  return {
    ...row,
    locale: record.locale,
    nameCheckStatus: record.nameCheckStatus,
    avatarCheckStatus: record.avatarCheckStatus,
    archivedAt: record.archivedAt,
    archiveReasonCategory: record.archiveReasonCategory,
    archivePublicMessage: record.archivePublicMessage,
    archiveInternalReason: viewer.canManage ? record.archiveReason : null,
    archivedByName,
    archivedByRole: record.archivedByRole,
    baseAuthorship,
    articleStats: articles.stats,
    articles: articles.rows,
    consents,
    sessions,
    appeal: viewer.canManage ? (record.accountAppeal ?? null) : null,
    canDecideAppeal: viewer.canManage && record.accountAppeal?.status === "submitted",
    canArchive: viewer.canManage && record.archivedAt === null,
    canRestore: viewer.canManage && record.archivedAt !== null,
    canRevokeSessions: viewer.canManage,
    canChangeEmail: viewer.canManage
  }
}

interface ArchiveTarget {
  id: string
  handle: string
  role: Role
  archivedAt: Date | null
  archiveMode: AccountArchiveMode | null
  planUntil: Date | null
}

async function loadTarget(ctx: GraphQLContext, tx: Prisma.TransactionClient, id: string): Promise<ArchiveTarget> {
  const target = await tx.user.findUnique({
    where: { id },
    select: {
      id: true,
      handle: true,
      role: true,
      archivedAt: true,
      archiveMode: true,
      planUntil: true,
      isServiceAccount: true
    }
  })
  if (!target || target.isServiceAccount || !PERSONAL_ROLES.includes(target.role)) {
    throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "user" })
  }
  return target
}

/**
 * Блокировка = архивирование аккаунта (журнал §5.5) одной транзакцией: доступ закрыт, сессии
 * отозваны, статьи каскадно в архиве с актором-сотрудником и его уровнем прав (журнал §3.3, #4,
 * #30). Медиа закрывается вместе с материалами: доступ к файлу выводится из статуса статьи и её
 * автора (журнал §11), отдельной отметки у файла нет.
 *
 * Оплаченный план не трогается ни в одной ветке: срок идёт без возврата и без паузы (журнал #50),
 * а экстренная блокировка выполняется немедленно даже при действующем плане (матрица #113).
 * Актор каскада — сотрудник, поэтому `restoreArticle` не даст автору вернуть эти статьи после
 * восстановления аккаунта (журнал §4.2–4, §5.4).
 */
export async function archiveAccount(
  ctx: GraphQLContext,
  input: ArchiveAccountInput,
  now = new Date()
): Promise<AdminUserCard> {
  const actor = ensureManager(ctx, "account.archive.admin")
  const mode: AccountArchiveMode = input.mode ?? "admin"
  if (mode === "self") {
    // Самостоятельный архив выполняет сам пользователь (`delete-account.md`), не сотрудник.
    throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "mode", rule: "admin-or-emergency" })
  }
  const internalReason = requiredText(input.internalReason, "internalReason", ctx.requestId)
  const publicMessage = input.publicMessage?.trim() ? input.publicMessage.trim() : null

  let handle = ""
  const archivedSlugs: string[] = []
  await ctx.prisma.$transaction(async (tx) => {
    const target = await loadTarget(ctx, tx, input.id)
    handle = target.handle
    // Уже закрытый административно аккаунт второй раз не блокируется (§9, flow §4); режим
    // `self` переводится в административный — это разрешённая ветка того же шага.
    if (target.archivedAt && target.archiveMode !== "self") {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "user",
        expected: "active",
        actual: "archived"
      })
    }

    const articles = await tx.article.findMany({
      where: { authorId: target.id, status: ACTIVE_ARTICLE_STATUS },
      select: { id: true, slug: true, status: true }
    })

    await tx.user.update({
      where: { id: target.id },
      data: {
        archivedAt: target.archivedAt ?? now,
        archiveMode: mode,
        archivedByActorId: actor.id,
        archivedByRole: actor.role,
        archiveReason: internalReason,
        archiveReasonCategory: input.reasonCategory,
        archivePublicMessage: publicMessage
      }
    })

    if (articles.length > 0) {
      await tx.article.updateMany({
        where: { authorId: target.id, status: ACTIVE_ARTICLE_STATUS },
        data: {
          status: "archived",
          archivedAt: now,
          archivedByActorId: actor.id,
          archivedByRole: actor.role,
          archiveReason: "account_archive"
        }
      })
      await tx.auditLog.createMany({
        data: articles.map((article) => ({
          action: "article.archive",
          actorId: actor.id,
          actorRole: actor.role,
          entityType: "article",
          entityId: article.id,
          diff: { status: { from: article.status, to: "archived" }, actor: "staff", cascade: true },
          requestId: ctx.requestId
        }))
      })
      archivedSlugs.push(...articles.map(({ slug }) => slug))
    }

    const revoked = await tx.session.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: now }
    })

    await tx.auditLog.create({
      data: {
        action: "user.archive",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: target.id,
        diff: {
          targetId: target.id,
          mode,
          reasonCategory: input.reasonCategory,
          reason: internalReason,
          hasPublicMessage: publicMessage !== null,
          cascadeArticles: articles.length,
          sessionsRevoked: revoked.count,
          // Срок оплаченного плана на момент блокировки: он продолжает идти (журнал #50).
          planUntil: target.planUntil?.toISOString() ?? null
        },
        requestId: ctx.requestId
      }
    })
  })

  ctx.logger.log({
    level: "info",
    event: "session.revoked",
    requestId: ctx.requestId,
    message: "Sessions revoked because the account was archived by staff",
    data: { userId: input.id, reason: mode === "emergency" ? "account_archive_emergency" : "account_archive_admin" }
  })

  // Закрытый доступ отвечает 410 сразу: страница автора и его материалы не ждут TTL кеша.
  await ctx.cache.delByTags([
    authorCacheTag(handle),
    ...buildArticleCacheTags(...archivedSlugs.map((slug) => ({ slug, author: { handle } })))
  ])

  const card = await getAdminUser(ctx, input.id, now)
  if (!card) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "user" })
  return card
}

/**
 * Восстановление (матрица #105): доступ возвращён, статьи остаются в архиве — автор возвращает
 * их сам (журнал §5.4, §25.7). Самостоятельный архив сотрудник восстанавливает по обращению
 * (flow §2 `[ДОПУЩЕНИЕ]`); план идёт своим сроком и здесь не трогается.
 */
export async function restoreAccount(
  ctx: GraphQLContext,
  input: { id: string; reason: string },
  now = new Date()
): Promise<AdminUserCard> {
  const actor = ensureManager(ctx, "account.restore.admin")
  const reason = requiredText(input.reason, "reason", ctx.requestId)

  let handle = ""
  await ctx.prisma.$transaction(async (tx) => {
    const target = await loadTarget(ctx, tx, input.id)
    handle = target.handle
    // Режим и срок плана читаются до снятия архива: после обновления полей уже нет.
    const archiveMode = target.archiveMode
    const planUntil = target.planUntil
    if (!target.archivedAt) {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "user",
        expected: "archived",
        actual: "active"
      })
    }

    const restored = await tx.user.updateMany({
      where: { id: target.id, archivedAt: { not: null } },
      data: {
        archivedAt: null,
        archiveMode: null,
        archivedByActorId: null,
        archivedByRole: null,
        archiveReason: null,
        archiveReasonCategory: null,
        archivePublicMessage: null
      }
    })
    // Параллельное восстановление (в том числе самим пользователем — §5.2) уже сняло архив.
    if (restored.count !== 1) {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "user",
        expected: "archived",
        actual: "active"
      })
    }

    const archivedArticles = await tx.article.count({ where: { authorId: target.id, status: "archived" } })
    await tx.auditLog.create({
      data: {
        action: "user.restore",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: target.id,
        diff: {
          targetId: target.id,
          mode: archiveMode,
          reason,
          // Статьи остаются в архиве: восстановление их не возвращает (журнал §5.4).
          articlesLeftArchived: archivedArticles,
          planUntil: planUntil?.toISOString() ?? null
        },
        requestId: ctx.requestId
      }
    })
  })

  await ctx.cache.delByTags([authorCacheTag(handle)])

  const card = await getAdminUser(ctx, input.id, now)
  if (!card) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "user" })
  return card
}

/** Отзыв чужих сессий (матрица #80): все сессии аккаунта закрываются, аккаунт остаётся активным. */
export async function revokeUserSessions(
  ctx: GraphQLContext,
  input: { id: string },
  now = new Date()
): Promise<RevokeUserSessionsResult> {
  const actor = ensureManager(ctx, "user.sessions.revoke")

  const revokedCount = await ctx.prisma.$transaction(async (tx) => {
    const target = await loadTarget(ctx, tx, input.id)
    const revoked = await tx.session.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: now }
    })
    await tx.auditLog.create({
      data: {
        action: "user.sessions.revoke",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: target.id,
        diff: { targetId: target.id, revokedCount: revoked.count },
        requestId: ctx.requestId
      }
    })
    return revoked.count
  })

  ctx.logger.log({
    level: "info",
    event: "session.revoked",
    requestId: ctx.requestId,
    message: "Sessions revoked by staff",
    data: { userId: input.id, reason: "admin_revoke", revokedCount }
  })

  return { revokedCount }
}

/**
 * Смена адреса сотрудником — ручная процедура восстановления доступа (flow #13 шаг Р2, матрица
 * #50). Личность проверяется вне продукта; здесь фиксируются новый адрес, причина и аудит.
 * Сессии не отзываются: смена адреса их не меняет (журнал §25.8).
 */
export async function adminChangeEmail(
  ctx: GraphQLContext,
  input: { id: string; newEmail: string; reason: string },
  now = new Date()
): Promise<AdminEmailChangeResult> {
  const actor = ensureManager(ctx, "email.change.admin")
  const reason = requiredText(input.reason, "reason", ctx.requestId)
  const newEmail = requiredText(input.newEmail, "newEmail", ctx.requestId).toLowerCase()
  if (!EMAIL_PATTERN.test(newEmail)) {
    throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "newEmail", rule: "email" })
  }

  await ctx.prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: input.id },
      select: { id: true, email: true, role: true, isServiceAccount: true }
    })
    if (!target || target.isServiceAccount || !PERSONAL_ROLES.includes(target.role)) {
      throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "user" })
    }
    if (target.email === newEmail) {
      throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "newEmail", rule: "different" })
    }

    const taken = await tx.user.findUnique({ where: { email: newEmail }, select: { id: true } })
    if (taken) {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "user",
        expected: "free email",
        actual: "taken"
      })
    }

    // Прежний адрес запоминается до обновления: он нужен записи аудита.
    const previousEmail = target.email
    await tx.user.update({ where: { id: target.id }, data: { email: newEmail } })
    // Открытый самостоятельный запрос смены адреса после ручной смены недействителен: его код
    // ушёл на другой адрес и подтвердил бы уже неактуальную замену.
    await tx.emailChangeRequest.deleteMany({ where: { userId: target.id } })
    await tx.auditLog.create({
      data: {
        action: "user.email.change",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: target.id,
        // Адрес в журнале раздела хранится хэшем (`users.md` §8): полный адрес остаётся в
        // записи аккаунта, а журнал читают и по фильтрам, и выгрузкой.
        diff: {
          targetId: target.id,
          via: "admin",
          reason,
          previousEmailHash: ctx.piiHasher.email(previousEmail),
          newEmailHash: ctx.piiHasher.email(newEmail)
        },
        requestId: ctx.requestId
      }
    })
  })

  return { emailMasked: maskEmail(newEmail), changedAt: now }
}
