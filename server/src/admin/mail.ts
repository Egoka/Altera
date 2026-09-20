import type { MailDeliveryStatus, Prisma, Role } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import { ensureAuthenticated, ensurePermission } from "../exceptions/permissions"
import { MAGIC_LINK_TEMPLATE } from "../mail/messages"
import type { GraphQLContext } from "../prisma"
import { calculatePagination, validatePagination, type PaginationInfo, type PaginationInput } from "../utils/admin"

/** Роли, которым §27.6 открывает адрес, тему и содержание письма. */
const FULL_ACCESS_ROLES = ["analyst", "admin", "owner"] as const
/** Роли, видящие письма только по своим статьям, без адреса и содержания `[ДОПУЩЕНИЕ]`. */
const SCOPED_ACCESS_ROLES = ["editor", "moderator"] as const
/** Статусы статьи, которые модератор ведёт в очереди проверки (как в сводке админки). */
const REVIEW_ARTICLE_STATUSES = ["review", "in_review", "rework"] as const

/** Шаблоны, копию которых нельзя отправить повторно: секрет выдаётся заново самим пользователем. */
export const SECRET_MAIL_TEMPLATES: ReadonlySet<string> = new Set([MAGIC_LINK_TEMPLATE])
/** Максимум писем в массовом повторе (`docs/spec/40-admin/mail.md` §6, `[ДОПУЩЕНИЕ]`). */
export const MAIL_BULK_RESEND_LIMIT = 100
/** Период списка по умолчанию — 7 дней (`docs/spec/40-admin/mail.md` §4, `[ДОПУЩЕНИЕ]`). */
export const MAIL_DEFAULT_PERIOD_DAYS = 7

export type AdminMailAccess = "full" | "scoped"

export interface AdminMailDeliveryEvent {
  id: string
  status: MailDeliveryStatus
  providerEventId: string | null
  errorClass: string | null
  occurredAt: Date
}

export interface AdminMailItem {
  id: string
  template: string
  recipientEmail: string | null
  recipientHandle: string | null
  subject: string
  body: string | null
  status: MailDeliveryStatus
  provider: string | null
  messageId: string | null
  deliveryErrorClass: string | null
  objectType: string | null
  objectId: string | null
  jobId: string | null
  queuedAt: Date
  sentAt: Date | null
  createdAt: Date
  deliveryEvents: AdminMailDeliveryEvent[]
  canResend: boolean
}

export interface AdminMailList {
  items: AdminMailItem[]
  pagination: PaginationInfo
  access: AdminMailAccess
  /** Письма стоят в очереди: провайдер не забрал их (плашка §9). */
  providerWaiting: boolean
}

export interface AdminMailSummaryRow {
  template: string
  queued: number
  sent: number
  bounced: number
  failed: number
}

export interface AdminMailFilters {
  template?: string | null
  status?: MailDeliveryStatus[] | null
  period?: { from?: string | null; to?: string | null } | null
  recipient?: string | null
  objectId?: string | null
  query?: string | null
}

export interface AdminMailResendResult {
  resent: number
  skipped: number
}

const mailSelect = {
  id: true,
  template: true,
  recipientEmail: true,
  subject: true,
  sanitizedBody: true,
  status: true,
  provider: true,
  messageId: true,
  deliveryErrorClass: true,
  objectType: true,
  objectId: true,
  jobId: true,
  queuedAt: true,
  sentAt: true,
  createdAt: true,
  deliveryEvents: {
    orderBy: { occurredAt: "asc" },
    select: { id: true, status: true, providerEventId: true, errorClass: true, occurredAt: true }
  }
} as const satisfies Prisma.MailMessageSelect

type MailRecord = Prisma.MailMessageGetPayload<{ select: typeof mailSelect }>

interface MailViewer {
  id: string
  role: Role
  access: AdminMailAccess
}

function ensureViewer(ctx: GraphQLContext, action: string): MailViewer {
  ensurePermission(ctx.currentUser, "admin.enter", action, ctx.requestId)
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  const role = user.role
  if ((FULL_ACCESS_ROLES as readonly Role[]).includes(role)) return { id: user.id, role, access: "full" }
  if ((SCOPED_ACCESS_ROLES as readonly Role[]).includes(role)) return { id: user.id, role, access: "scoped" }
  throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action })
}

/** Письма своих статей: редактор ведёт редакционные материалы, модератор — очередь проверки. */
async function scopedArticleIds(ctx: GraphQLContext, viewer: MailViewer): Promise<string[]> {
  const where: Prisma.ArticleWhereInput =
    viewer.role === "editor" ? { isEditorial: true } : { status: { in: [...REVIEW_ARTICLE_STATUSES] } }
  const articles = await ctx.prisma.article.findMany({ where, select: { id: true } })
  return articles.map(({ id }) => id)
}

function parseDate(value: string, field: string, requestId: string): Date {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw createApiError("VALIDATION_ERROR", { requestId, field, rule: "iso-date" })
  }
  return parsed
}

function periodWhere(filters: AdminMailFilters, requestId: string, now: Date): Prisma.DateTimeFilter {
  const from = filters.period?.from
  const to = filters.period?.to
  if (!from && !to) {
    const start = new Date(now)
    start.setUTCDate(start.getUTCDate() - MAIL_DEFAULT_PERIOD_DAYS)
    return { gte: start }
  }
  const range: Prisma.DateTimeFilter = {}
  if (from) range.gte = parseDate(from, "period.from", requestId)
  if (to) range.lte = parseDate(to, "period.to", requestId)
  return range
}

/** Получатель ищется по адресу и по хэндлу: хэндл переводится в адреса своих аккаунтов. */
async function recipientWhere(ctx: GraphQLContext, recipient: string): Promise<Prisma.MailMessageWhereInput> {
  const byHandle = await ctx.prisma.user.findMany({
    where: { handle: { contains: recipient, mode: "insensitive" } },
    select: { email: true }
  })
  const emails = byHandle.map(({ email }) => email)
  return {
    OR: [
      { recipientEmail: { contains: recipient, mode: "insensitive" } },
      ...(emails.length ? [{ recipientEmail: { in: emails } }] : [])
    ]
  }
}

async function buildWhere(
  ctx: GraphQLContext,
  viewer: MailViewer,
  filters: AdminMailFilters,
  now: Date
): Promise<Prisma.MailMessageWhereInput> {
  const conditions: Prisma.MailMessageWhereInput[] = [{ createdAt: periodWhere(filters, ctx.requestId, now) }]

  if (filters.template) conditions.push({ template: filters.template })
  if (filters.status?.length) conditions.push({ status: { in: filters.status } })
  if (filters.objectId) conditions.push({ objectId: filters.objectId })
  if (filters.query) {
    conditions.push({
      OR: [
        { subject: { contains: filters.query, mode: "insensitive" } },
        { messageId: { contains: filters.query, mode: "insensitive" } }
      ]
    })
  }
  if (filters.recipient && viewer.access === "full") {
    conditions.push(await recipientWhere(ctx, filters.recipient))
  }
  if (viewer.access === "scoped") {
    conditions.push({ objectType: "Article", objectId: { in: await scopedArticleIds(ctx, viewer) } })
  }

  return { AND: conditions }
}

async function auditPersonalRead(
  ctx: GraphQLContext,
  viewer: MailViewer,
  entityType: string,
  entityId: string,
  purpose: string
): Promise<void> {
  await ctx.prisma.auditLog.create({
    data: {
      action: "admin.read.personal",
      actorId: viewer.id,
      actorRole: viewer.role,
      entityType,
      entityId,
      context: "mail",
      purpose,
      requestId: ctx.requestId
    }
  })
}

async function resolveHandles(ctx: GraphQLContext, mails: MailRecord[]): Promise<Map<string, string>> {
  const emails = [...new Set(mails.map(({ recipientEmail }) => recipientEmail))]
  if (!emails.length) return new Map()
  const users = await ctx.prisma.user.findMany({
    where: { email: { in: emails } },
    select: { email: true, handle: true }
  })
  return new Map(users.flatMap(({ email, handle }) => (handle ? [[email, handle] as const] : [])))
}

function presentMail(mail: MailRecord, access: AdminMailAccess, handle: string | null): AdminMailItem {
  const visible = access === "full"
  return {
    id: mail.id,
    template: mail.template,
    recipientEmail: visible ? mail.recipientEmail : null,
    recipientHandle: handle,
    subject: mail.subject,
    body: visible ? mail.sanitizedBody : null,
    status: mail.status,
    provider: mail.provider,
    messageId: mail.messageId,
    deliveryErrorClass: mail.deliveryErrorClass,
    objectType: mail.objectType,
    objectId: mail.objectId,
    jobId: mail.jobId,
    queuedAt: mail.queuedAt,
    sentAt: mail.sentAt,
    createdAt: mail.createdAt,
    deliveryEvents: mail.deliveryEvents,
    canResend: mail.status === "failed" && !SECRET_MAIL_TEMPLATES.has(mail.template)
  }
}

export async function listAdminMails(
  ctx: GraphQLContext,
  args: { filters?: AdminMailFilters | null; pagination?: PaginationInput | null },
  now = new Date()
): Promise<AdminMailList> {
  const viewer = ensureViewer(ctx, "admin.mail.read")
  const pagination = { page: args.pagination?.page ?? 1, limit: args.pagination?.limit ?? 20 }
  validatePagination(pagination, ctx.requestId)

  const filters = args.filters ?? {}
  const where = await buildWhere(ctx, viewer, filters, now)
  const total = await ctx.prisma.mailMessage.count({ where })
  const { skip, take, pagination: paginationInfo } = calculatePagination(pagination.page, pagination.limit, total)

  const mails = await ctx.prisma.mailMessage.findMany({
    where,
    skip,
    take,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: mailSelect
  })

  // Фильтр по получателю — чтение ПДн, даже когда список пуст (§8).
  if (filters.recipient && viewer.access === "full") {
    await auditPersonalRead(ctx, viewer, "mailSearch", ctx.piiHasher.email(filters.recipient), "admin.mail.search")
  }

  const handles = await resolveHandles(ctx, mails)
  const queued = await ctx.prisma.mailMessage.count({ where: { AND: [where, { status: "queued" }] } })

  return {
    items: mails.map((mail) => presentMail(mail, viewer.access, handles.get(mail.recipientEmail) ?? null)),
    pagination: paginationInfo,
    access: viewer.access,
    providerWaiting: queued > 0
  }
}

export async function getAdminMail(ctx: GraphQLContext, id: string): Promise<AdminMailItem | null> {
  const viewer = ensureViewer(ctx, "admin.mail.read")
  const mail = await ctx.prisma.mailMessage.findUnique({ where: { id }, select: mailSelect })
  if (!mail) return null

  if (viewer.access === "scoped") {
    const allowed = mail.objectType === "Article" && mail.objectId !== null
    const scoped = allowed ? await scopedArticleIds(ctx, viewer) : []
    // Письмо вне своих статей не существует для editor и moderator (§2).
    if (!allowed || !scoped.includes(mail.objectId as string)) {
      throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "mailMessage" })
    }
  } else {
    await auditPersonalRead(ctx, viewer, "mailMessage", mail.id, "admin.mail.read")
  }

  const handles = await resolveHandles(ctx, [mail])
  return presentMail(mail, viewer.access, handles.get(mail.recipientEmail) ?? null)
}

export async function getMailSummary(ctx: GraphQLContext, periodDays: 7 | 30, now = new Date()) {
  const viewer = ensureViewer(ctx, "admin.mail.read")
  const periodStart = new Date(now)
  periodStart.setUTCDate(periodStart.getUTCDate() - periodDays)

  const where = await buildWhere(ctx, viewer, { period: { from: periodStart.toISOString() } }, now)
  const grouped = await ctx.prisma.mailMessage.groupBy({
    by: ["template", "status"],
    where,
    _count: { _all: true }
  })

  const rows = new Map<string, AdminMailSummaryRow>()
  for (const entry of grouped) {
    const row = rows.get(entry.template) ?? { template: entry.template, queued: 0, sent: 0, bounced: 0, failed: 0 }
    row[entry.status] += entry._count._all
    rows.set(entry.template, row)
  }

  return [...rows.values()].sort((left, right) => left.template.localeCompare(right.template))
}

function htmlFromText(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`)
    .join("")
}

async function alreadyResent(ctx: GraphQLContext, mailId: string): Promise<boolean> {
  const previous = await ctx.prisma.auditLog.findFirst({
    where: { action: "job.retry", entityType: "mailMessage", entityId: mailId },
    select: { id: true }
  })
  return previous !== null
}

async function resendOne(ctx: GraphQLContext, viewer: MailViewer, mail: MailRecord): Promise<void> {
  await ctx.prisma.auditLog.create({
    data: {
      action: "job.retry",
      actorId: viewer.id,
      actorRole: viewer.role,
      entityType: "mailMessage",
      entityId: mail.id,
      diff: { template: mail.template },
      requestId: ctx.requestId
    }
  })
  await ctx.mail.send({
    template: mail.template,
    to: mail.recipientEmail,
    // Полного текста в истории нет: повторяется сохранённая копия без секретов (§3).
    content: { subject: mail.subject, text: mail.sanitizedBody, html: htmlFromText(mail.sanitizedBody) },
    sanitizedBody: mail.sanitizedBody,
    objectType: mail.objectType ?? undefined,
    objectId: mail.objectId ?? undefined,
    requestId: ctx.requestId
  })
}

function ensureResendable(ctx: GraphQLContext, mail: MailRecord): void {
  if (SECRET_MAIL_TEMPLATES.has(mail.template)) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: "mail.resend" })
  }
  if (mail.status !== "failed") {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "mailMessage",
      expected: "failed",
      actual: mail.status
    })
  }
}

function ensureOwnerResend(ctx: GraphQLContext): MailViewer {
  // Повтор — право `job.retry`, по умолчанию только у `owner` (§5, `[ДОПУЩЕНИЕ]`).
  ensurePermission(ctx.currentUser, "job.retry", "mail.resend", ctx.requestId)
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  return { id: user.id, role: user.role, access: "full" }
}

export async function resendMail(ctx: GraphQLContext, id: string): Promise<AdminMailItem> {
  const viewer = ensureOwnerResend(ctx)
  const mail = await ctx.prisma.mailMessage.findUnique({ where: { id }, select: mailSelect })
  if (!mail) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "mailMessage" })

  ensureResendable(ctx, mail)
  if (await alreadyResent(ctx, mail.id)) {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "mailMessage",
      expected: "not-resent",
      actual: "resent"
    })
  }

  await resendOne(ctx, viewer, mail)
  const handles = await resolveHandles(ctx, [mail])
  return presentMail(mail, viewer.access, handles.get(mail.recipientEmail) ?? null)
}

export async function resendMails(ctx: GraphQLContext, ids: string[]): Promise<AdminMailResendResult> {
  const viewer = ensureOwnerResend(ctx)
  if (ids.length > MAIL_BULK_RESEND_LIMIT) {
    throw createApiError("VALIDATION_ERROR", {
      requestId: ctx.requestId,
      field: "ids",
      rule: `max:${MAIL_BULK_RESEND_LIMIT}`
    })
  }

  const mails = await ctx.prisma.mailMessage.findMany({ where: { id: { in: ids } }, select: mailSelect })
  let resent = 0
  let skipped = 0

  for (const mail of mails) {
    // Письма с секретами и уже повторённые исключаются из массового повтора автоматически (§6).
    if (SECRET_MAIL_TEMPLATES.has(mail.template) || mail.status !== "failed" || (await alreadyResent(ctx, mail.id))) {
      skipped += 1
      continue
    }
    try {
      await resendOne(ctx, viewer, mail)
      resent += 1
    } catch {
      skipped += 1
    }
  }

  return { resent, skipped: skipped + (ids.length - mails.length) }
}
