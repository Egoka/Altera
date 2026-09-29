import type { AiProcessKind, AiProcessStatus, Locale, Role } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import { ensureAuthenticated, ensurePermission } from "../exceptions/permissions"
import type { GraphQLContext } from "../prisma"
import { RATE_LIMIT_RULES } from "../rate-limits"

const DAY_MS = 24 * 60 * 60 * 1000
const EXPORT_ACTION = "stats.export"
const EXPORT_RULE = RATE_LIMIT_RULES["admin.export.user"]
const EXPORT_WINDOW_MS = EXPORT_RULE.windowSeconds * 1000
const QUEUE_STATUSES = new Set(["review", "in_review", "rework"])
const DECISION_KINDS = new Set(["manual_publish", "published_auto", "final_reject", "rework_request"])

export type StatisticsPeriod = "DAYS_7" | "DAYS_30" | "DAYS_90" | "CUSTOM"
export type StatisticsTab = "GROWTH" | "CONTENT" | "AI"

export interface StatisticsRangeInput {
  period: StatisticsPeriod
  from?: string | null
  to?: string | null
  sectionId?: string | null
  locale?: Locale | null
}

interface StatisticsRange {
  from: Date
  to: Date
  fromIso: string
  toIso: string
}

export interface StatisticsBucket {
  key: string
  count: number
}

export interface StatisticsLabelBucket extends StatisticsBucket {
  label: string
}

export interface GrowthDailyPoint {
  date: string
  registrations: number
  publications: number
}

export interface GrowthStatistics {
  range: { from: string; to: string }
  registrations: number
  activeAccounts: number
  enabledAuthors: number
  authorsWithPublications: number
  daily: GrowthDailyPoint[]
}

export interface TopAuthorStatistics {
  id: string
  name: string
  handle: string
  publications: number
  qualifiedReads: number | null
  saves: number
}

export interface TopArticleStatistics {
  id: string
  slug: string
  title: string
  authorId: string
  authorName: string
  publications: number
  qualifiedReads: number | null
  saves: number
  totalScore: number | null
}

export interface ContentStatistics {
  range: { from: string; to: string }
  publications: number
  drafts: number
  queueSize: number
  oldestQueueAgeHours: number | null
  medianDecisionHours: number | null
  rejectionRate: number
  manualOverrideRate: number
  byLocale: StatisticsBucket[]
  bySection: StatisticsLabelBucket[]
  topAuthors: TopAuthorStatistics[]
  topArticles: TopArticleStatistics[]
}

export interface AiStatistics {
  range: { from: string; to: string }
  total: number
  failed: number
  failureRate: number
  averageDurationMs: number | null
  costMinor: string
  byKind: StatisticsBucket[]
  byStatus: StatisticsBucket[]
}

export interface StatisticsExport {
  filename: string
  contentType: string
  rows: number
  csv: string
}

interface UserRow {
  id: string
  createdAt: Date
  sessions: Array<{ id: string }>
}

interface ReviewMessageRow {
  kind: string
  createdAt: Date
}

interface TranslationRow {
  id: string
  locale: Locale
  status: string
  publishedAt: Date | null
  createdAt: Date
  reviewMessages: ReviewMessageRow[]
}

interface ArticleRow {
  id: string
  authorId: string
  title: string
  slug: string
  section: { id: string; name: string } | null
  author: { id: string; name: string; handle: string }
  bookmarks: Array<{ userId: string }>
  translations: TranslationRow[]
}

interface AiProcessRow {
  kind: AiProcessKind
  status: AiProcessStatus
  durationMs: number | null
}

interface AiCostRow {
  kind: AiProcessKind
  totalCostMinor: bigint
  processCount: number
}

const publicAccountWhere = {
  isServiceAccount: false,
  isTestAccount: false,
  email: { not: { endsWith: "@example.test" } }
} as const

function ensureStatisticsReader(ctx: GraphQLContext) {
  ensurePermission(ctx.currentUser, "finance", "stats.read", ctx.requestId)
  return ensureAuthenticated(ctx.currentUser, ctx.requestId)
}

function parseCalendarDate(value: string | null | undefined, edge: "from" | "to", requestId: string): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: edge, rule: "YYYY-MM-DD" })
  }
  const suffix = edge === "from" ? "T00:00:00.000Z" : "T23:59:59.999Z"
  const parsed = new Date(`${value}${suffix}`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: edge, rule: "valid-date" })
  }
  return parsed
}

function resolveRange(input: StatisticsRangeInput, now: Date, requestId: string): StatisticsRange {
  let from: Date
  let to: Date
  if (input.period === "CUSTOM") {
    from = parseCalendarDate(input.from, "from", requestId)
    to = parseCalendarDate(input.to, "to", requestId)
  } else {
    const days = input.period === "DAYS_7" ? 7 : input.period === "DAYS_90" ? 90 : 30
    to = new Date(now)
    from = new Date(to.getTime() - (days - 1) * DAY_MS)
  }

  if (from > to) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "from", rule: "before-to" })
  }
  return { from, to, fromIso: from.toISOString(), toIso: to.toISOString() }
}

const inRange = (value: Date | null, range: StatisticsRange): value is Date =>
  value !== null && value >= range.from && value <= range.to

const dateKey = (value: Date): string => value.toISOString().slice(0, 10)

function increment(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount)
}

const buckets = (map: Map<string, number>): StatisticsBucket[] =>
  [...map.entries()].map(([key, count]) => ({ key, count })).sort((left, right) => left.key.localeCompare(right.key))

async function readUsers(ctx: GraphQLContext, range: StatisticsRange): Promise<UserRow[]> {
  return (await ctx.prisma.user.findMany({
    where: { ...publicAccountWhere, createdAt: { lte: range.to } },
    select: {
      id: true,
      createdAt: true,
      sessions: { where: { lastUsedAt: { gte: range.from, lte: range.to }, revokedAt: null }, select: { id: true } }
    }
  })) as UserRow[]
}

async function readArticles(ctx: GraphQLContext, input: StatisticsRangeInput): Promise<ArticleRow[]> {
  return (await ctx.prisma.article.findMany({
    where: {
      author: { ...publicAccountWhere },
      ...(input.sectionId ? { sectionId: input.sectionId } : {})
    },
    select: {
      id: true,
      authorId: true,
      title: true,
      slug: true,
      section: { select: { id: true, name: true } },
      author: { select: { id: true, name: true, handle: true } },
      bookmarks: { where: { user: { ...publicAccountWhere } }, select: { userId: true } },
      translations: {
        where: input.locale ? { locale: input.locale } : undefined,
        select: {
          id: true,
          locale: true,
          status: true,
          publishedAt: true,
          createdAt: true,
          reviewMessages: { select: { kind: true, createdAt: true }, orderBy: { createdAt: "asc" } }
        }
      }
    }
  })) as ArticleRow[]
}

export async function getGrowthStatistics(
  ctx: GraphQLContext,
  input: StatisticsRangeInput,
  now = new Date()
): Promise<GrowthStatistics> {
  ensureStatisticsReader(ctx)
  const range = resolveRange(input, now, ctx.requestId)
  const [users, grants, articles] = await Promise.all([
    readUsers(ctx, range),
    ctx.prisma.planGrant.findMany({
      where: {
        user: { ...publicAccountWhere },
        startsAt: { lte: range.to },
        revokedAt: null,
        OR: [{ endsAt: null }, { endsAt: { gt: range.from } }]
      },
      select: { userId: true }
    }),
    readArticles(ctx, input)
  ])

  const registrations = users.filter((user) => inRange(user.createdAt, range))
  const published = articles.flatMap((article) =>
    article.translations
      .filter((translation) => translation.status === "published" && inRange(translation.publishedAt, range))
      .map((translation) => ({ authorId: article.authorId, publishedAt: translation.publishedAt as Date }))
  )
  const daily = new Map<string, GrowthDailyPoint>()
  const point = (date: string) => daily.get(date) ?? { date, registrations: 0, publications: 0 }
  for (const user of registrations) {
    const key = dateKey(user.createdAt)
    daily.set(key, { ...point(key), registrations: point(key).registrations + 1 })
  }
  for (const publication of published) {
    const key = dateKey(publication.publishedAt)
    daily.set(key, { ...point(key), publications: point(key).publications + 1 })
  }

  return {
    range: { from: range.fromIso, to: range.toIso },
    registrations: registrations.length,
    activeAccounts: users.filter((user) => user.sessions.length > 0).length,
    enabledAuthors: new Set(grants.map(({ userId }) => userId)).size,
    authorsWithPublications: new Set(published.map(({ authorId }) => authorId)).size,
    daily: [...daily.values()].sort((left, right) => left.date.localeCompare(right.date))
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

export async function getContentStatistics(
  ctx: GraphQLContext,
  input: StatisticsRangeInput,
  now = new Date()
): Promise<ContentStatistics> {
  ensureStatisticsReader(ctx)
  const range = resolveRange(input, now, ctx.requestId)
  const articles = await readArticles(ctx, input)
  const publicationsByLocale = new Map<string, number>([
    ["en", 0],
    ["ru", 0]
  ])
  const publicationsBySection = new Map<string, { label: string; count: number }>()
  const decisions: Array<{ kind: string; durationHours: number }> = []
  const queueSubmittedAt: Date[] = []
  let drafts = 0
  let queueSize = 0

  const topAuthors = new Map<string, TopAuthorStatistics>()
  const topArticles: TopArticleStatistics[] = []

  for (const article of articles) {
    let articlePublications = 0
    for (const translation of article.translations) {
      const submissions = translation.reviewMessages.filter(({ kind }) => kind === "submitted")
      const submitted = submissions[submissions.length - 1]
      if (translation.status === "draft") drafts += 1
      if (QUEUE_STATUSES.has(translation.status)) {
        queueSize += 1
        if (submitted) queueSubmittedAt.push(submitted.createdAt)
      }

      const decision = translation.reviewMessages.find(
        (message) => submitted && DECISION_KINDS.has(message.kind) && message.createdAt >= submitted.createdAt
      )
      if (submitted && decision && inRange(decision.createdAt, range)) {
        decisions.push({
          kind: decision.kind,
          durationHours: (decision.createdAt.getTime() - submitted.createdAt.getTime()) / 3_600_000
        })
      }

      if (translation.status !== "published" || !inRange(translation.publishedAt, range)) continue
      articlePublications += 1
      increment(publicationsByLocale, translation.locale)
      if (article.section) {
        const bucket = publicationsBySection.get(article.section.id) ?? { label: article.section.name, count: 0 }
        bucket.count += 1
        publicationsBySection.set(article.section.id, bucket)
      }
    }

    if (articlePublications === 0) continue
    const author = topAuthors.get(article.authorId) ?? {
      id: article.author.id,
      name: article.author.name,
      handle: article.author.handle,
      publications: 0,
      qualifiedReads: null,
      saves: 0
    }
    author.publications += articlePublications
    author.saves += article.bookmarks.length
    topAuthors.set(article.authorId, author)
    topArticles.push({
      id: article.id,
      slug: article.slug,
      title: article.title,
      authorId: article.author.id,
      authorName: article.author.name,
      publications: articlePublications,
      qualifiedReads: null,
      saves: article.bookmarks.length,
      totalScore: null
    })
  }

  const publicationCount = [...publicationsByLocale.values()].reduce((sum, count) => sum + count, 0)
  const manualPublishes = decisions.filter(({ kind }) => kind === "manual_publish").length
  const publishDecisions = decisions.filter(({ kind }) => kind === "manual_publish" || kind === "published_auto").length
  const rejected = decisions.filter(({ kind }) => kind === "final_reject" || kind === "rework_request").length

  return {
    range: { from: range.fromIso, to: range.toIso },
    publications: publicationCount,
    drafts,
    queueSize,
    oldestQueueAgeHours:
      queueSubmittedAt.length === 0
        ? null
        : Math.floor((now.getTime() - Math.min(...queueSubmittedAt.map((value) => value.getTime()))) / 3_600_000),
    medianDecisionHours: median(decisions.map(({ durationHours }) => durationHours)),
    rejectionRate: decisions.length === 0 ? 0 : rejected / decisions.length,
    manualOverrideRate: publishDecisions === 0 ? 0 : manualPublishes / publishDecisions,
    byLocale: buckets(publicationsByLocale),
    bySection: [...publicationsBySection.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((left, right) => left.key.localeCompare(right.key)),
    topAuthors: [...topAuthors.values()].sort(
      (left, right) =>
        right.publications - left.publications || right.saves - left.saves || left.id.localeCompare(right.id)
    ),
    topArticles: topArticles.sort(
      (left, right) =>
        right.publications - left.publications || right.saves - left.saves || left.id.localeCompare(right.id)
    )
  }
}

export async function getAiStatistics(
  ctx: GraphQLContext,
  input: StatisticsRangeInput,
  now = new Date()
): Promise<AiStatistics> {
  ensureStatisticsReader(ctx)
  const range = resolveRange(input, now, ctx.requestId)
  const [processes, costs] = (await Promise.all([
    ctx.prisma.aiProcess.findMany({
      where: { createdAt: { gte: range.from, lte: range.to } },
      select: { kind: true, status: true, durationMs: true }
    }),
    ctx.prisma.aiCostAggregate.findMany({
      where: { bucketStart: { lte: range.to }, bucketEnd: { gte: range.from } },
      select: { kind: true, totalCostMinor: true, processCount: true }
    })
  ])) as [AiProcessRow[], AiCostRow[]]

  const byKind = new Map<string, number>()
  const byStatus = new Map<string, number>()
  for (const process of processes) {
    increment(byKind, process.kind)
    increment(byStatus, process.status)
  }
  const completedDurations = processes.flatMap(({ status, durationMs }) =>
    status === "completed" && durationMs !== null ? [durationMs] : []
  )
  const failed = processes.filter(({ status }) => status === "failed").length

  return {
    range: { from: range.fromIso, to: range.toIso },
    total: processes.length,
    failed,
    failureRate: processes.length === 0 ? 0 : failed / processes.length,
    averageDurationMs:
      completedDurations.length === 0
        ? null
        : completedDurations.reduce((sum, duration) => sum + duration, 0) / completedDurations.length,
    costMinor: costs.reduce((sum, row) => sum + row.totalCostMinor, 0n).toString(),
    byKind: buckets(byKind),
    byStatus: buckets(byStatus)
  }
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function rowsToCsv(rows: ReadonlyArray<readonly [string, string | number | null]>): string {
  return `metric,value\n${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`
}

async function ensureExportAvailable(ctx: GraphQLContext, now: Date) {
  ensurePermission(ctx.currentUser, "finance", EXPORT_ACTION, ctx.requestId)
  const actor = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  const windowStart = new Date(now.getTime() - EXPORT_WINDOW_MS)
  const recent = await ctx.prisma.auditLog.findMany({
    where: { action: EXPORT_ACTION, actorId: actor.id, createdAt: { gte: windowStart } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true }
  })
  if (recent.length < EXPORT_RULE.limit) return actor

  const oldest = recent[0]?.createdAt ?? windowStart
  const retryAfter = Math.max(1, Math.ceil((oldest.getTime() + EXPORT_WINDOW_MS - now.getTime()) / 1000))
  ctx.logger.log({
    level: "info",
    event: "rate_limit.hit",
    requestId: ctx.requestId,
    message: "Rate limit exceeded",
    data: { bucket: EXPORT_RULE.bucket, ipHash: null }
  })
  throw createApiError("RATE_LIMITED", { requestId: ctx.requestId, retryAfter })
}

export async function exportStatisticsCsv(
  ctx: GraphQLContext,
  input: { tab: StatisticsTab; range: StatisticsRangeInput },
  now = new Date()
): Promise<StatisticsExport> {
  const actor = await ensureExportAvailable(ctx, now)
  let rows: Array<readonly [string, string | number | null]>
  const tab = input.tab.toLowerCase()

  if (input.tab === "GROWTH") {
    const stats = await getGrowthStatistics(ctx, input.range, now)
    rows = [
      ["registrations", stats.registrations],
      ["activeAccounts", stats.activeAccounts],
      ["enabledAuthors", stats.enabledAuthors],
      ["authorsWithPublications", stats.authorsWithPublications]
    ]
  } else if (input.tab === "CONTENT") {
    const stats = await getContentStatistics(ctx, input.range, now)
    rows = [
      ["publications", stats.publications],
      ["drafts", stats.drafts],
      ["queueSize", stats.queueSize],
      ["oldestQueueAgeHours", stats.oldestQueueAgeHours],
      ["medianDecisionHours", stats.medianDecisionHours],
      ["rejectionRate", stats.rejectionRate],
      ["manualOverrideRate", stats.manualOverrideRate]
    ]
  } else {
    const stats = await getAiStatistics(ctx, input.range, now)
    rows = [
      ["total", stats.total],
      ["failed", stats.failed],
      ["failureRate", stats.failureRate],
      ["averageDurationMs", stats.averageDurationMs],
      ["costMinor", stats.costMinor]
    ]
  }

  await ctx.prisma.auditLog.create({
    data: {
      action: EXPORT_ACTION,
      actorId: actor.id,
      actorRole: actor.role as Role,
      entityType: "statistics",
      entityId: tab,
      diff: {
        tab,
        period: input.range.period,
        from: input.range.from ?? null,
        to: input.range.to ?? null,
        sectionId: input.range.sectionId ?? null,
        locale: input.range.locale ?? null,
        rows: rows.length
      },
      requestId: ctx.requestId
    }
  })

  return {
    filename: `statistics-${tab}-${now.toISOString().slice(0, 10)}.csv`,
    contentType: "text/csv",
    rows: rows.length,
    csv: rowsToCsv(rows)
  }
}
