/**
 * Раздел админки «Обращения» (`docs/spec/00-registries/admin-sections.md` #23, журнал §37 п. 13):
 * очередь обращений в поддержку со статусом «принято / отвечено», который владелец аккаунта
 * видит в кабинете (журнал §37 п. 2).
 *
 * Очередь ведут `admin` и `owner` (матрица #117); прочие служебные роли раздел не открывают.
 * Обращение несёт e-mail и текст отправителя — персональные данные (`20-public/contact.md` §2),
 * поэтому порядок тот же, что в разделе «Письма» (журнал §28.7): в списке адрес идёт маской и
 * текста нет, полный адрес и текст отдаёт только карточка и пишет `admin.read.personal`.
 */
import type { Prisma, Role, SupportTopic } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import { ensureAuthenticated, ensurePermission } from "../exceptions/permissions"
import type { GraphQLContext } from "../prisma"
import { calculatePagination, validatePagination, type PaginationInfo, type PaginationInput } from "../utils/admin"
import { maskEmail } from "./personal-data"

/** Роли очереди обращений (`admin-sections.md` #23, матрица #117). */
const QUEUE_ROLES = ["admin", "owner"] as const
/** Размер страницы очереди по умолчанию `[ДОПУЩЕНИЕ]`: файла раздела нет, взят общий для админки. */
export const SUPPORT_QUEUE_DEFAULT_LIMIT = 20

/** Статус обращения: «принято» до ответа, «отвечено» после (журнал §37 п. 2). */
export type SupportRequestStatus = "received" | "answered"

export interface AdminSupportRequestItem {
  id: string
  ticketNo: number
  topic: SupportTopic
  status: SupportRequestStatus
  /** Адрес ответа: в списке — маска, в карточке — полностью; у анонимной записи адреса нет. */
  email: string | null
  emailMasked: boolean
  /** Текст обращения — только карточка: в списке он был бы обходом записи чтения ПДн. */
  message: string | null
  path: string | null
  requestId: string | null
  locale: string
  createdAt: Date
  answeredAt: Date | null
  answeredBy: { id: string; name: string } | null
  /** Обращение оставил аккаунт: он видит статус в кабинете, гостю ответ уходит только письмом. */
  fromAccount: boolean
}

export interface AdminSupportRequestList {
  items: AdminSupportRequestItem[]
  pagination: PaginationInfo
  /** Сколько обращений ещё без ответа — счётчик очереди над таблицей. */
  openCount: number
}

export interface AdminSupportRequestFilters {
  status?: SupportRequestStatus | null
  topic?: SupportTopic[] | null
}

const supportSelect = {
  id: true,
  ticketNo: true,
  topic: true,
  email: true,
  message: true,
  path: true,
  requestId: true,
  locale: true,
  createdAt: true,
  answeredAt: true,
  userId: true,
  answeredBy: { select: { id: true, name: true } }
} as const satisfies Prisma.SupportRequestSelect

type SupportRecord = Prisma.SupportRequestGetPayload<{ select: typeof supportSelect }>

interface SupportViewer {
  id: string
  role: Role
}

function ensureViewer(ctx: GraphQLContext, action: string): SupportViewer {
  ensurePermission(ctx.currentUser, "admin.enter", action, ctx.requestId)
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  if (!(QUEUE_ROLES as readonly Role[]).includes(user.role)) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action })
  }
  return { id: user.id, role: user.role }
}

function buildWhere(filters: AdminSupportRequestFilters): Prisma.SupportRequestWhereInput {
  const conditions: Prisma.SupportRequestWhereInput[] = []
  if (filters.status === "received") conditions.push({ answeredAt: null })
  if (filters.status === "answered") conditions.push({ answeredAt: { not: null } })
  if (filters.topic?.length) conditions.push({ topic: { in: filters.topic } })
  return conditions.length ? { AND: conditions } : {}
}

function present(record: SupportRecord, view: "list" | "card"): AdminSupportRequestItem {
  const masked = view === "list"
  return {
    id: record.id,
    ticketNo: record.ticketNo,
    topic: record.topic,
    status: record.answeredAt ? "answered" : "received",
    email: record.email ? (masked ? maskEmail(record.email) : record.email) : null,
    emailMasked: masked && record.email !== null,
    message: masked ? null : record.message,
    path: record.path,
    requestId: record.requestId,
    locale: record.locale,
    createdAt: record.createdAt,
    answeredAt: record.answeredAt,
    answeredBy: record.answeredBy,
    fromAccount: record.userId !== null
  }
}

/** Открытие карточки — чтение ПДн отправителя (журнал §28.7, §6 матрицы аудита). */
async function auditPersonalRead(ctx: GraphQLContext, viewer: SupportViewer, record: SupportRecord): Promise<void> {
  await ctx.prisma.auditLog.create({
    data: {
      action: "admin.read.personal",
      actorId: viewer.id,
      actorRole: viewer.role,
      entityType: "supportRequest",
      entityId: record.id,
      context: "support",
      purpose: "admin.support.read",
      requestId: ctx.requestId
    }
  })
}

export async function listAdminSupportRequests(
  ctx: GraphQLContext,
  args: { filters?: AdminSupportRequestFilters | null; pagination?: PaginationInput | null }
): Promise<AdminSupportRequestList> {
  ensureViewer(ctx, "admin.support.read")
  const pagination = {
    page: args.pagination?.page ?? 1,
    limit: args.pagination?.limit ?? SUPPORT_QUEUE_DEFAULT_LIMIT
  }
  validatePagination(pagination, ctx.requestId)

  const where = buildWhere(args.filters ?? {})
  const total = await ctx.prisma.supportRequest.count({ where })
  const { skip, take, pagination: paginationInfo } = calculatePagination(pagination.page, pagination.limit, total)

  const records = await ctx.prisma.supportRequest.findMany({
    where,
    skip,
    take,
    // Неотвеченные сверху: очередь разбирается, а не просматривается по дате (§1 раздела).
    orderBy: [{ answeredAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }, { id: "desc" }],
    select: supportSelect
  })
  const openCount = await ctx.prisma.supportRequest.count({ where: { answeredAt: null } })

  return {
    items: records.map((record) => present(record, "list")),
    pagination: paginationInfo,
    openCount
  }
}

export async function getAdminSupportRequest(ctx: GraphQLContext, id: string): Promise<AdminSupportRequestItem | null> {
  const viewer = ensureViewer(ctx, "admin.support.read")
  const record = await ctx.prisma.supportRequest.findUnique({ where: { id }, select: supportSelect })
  if (!record) return null

  // Карточка раскрывает адрес и текст обращения, поэтому запись аудита идёт до ответа клиенту.
  await auditPersonalRead(ctx, viewer, record)
  return present(record, "card")
}

/**
 * Отметка ответа. Сам ответ уходит письмом на указанный адрес (`contact.md` §4), а шаблоны писем
 * отложены (F-05, журнал §42), поэтому продукт фиксирует только факт ответа: текст ответа не
 * хранится `[ДОПУЩЕНИЕ]`. Повторная отметка отклоняется — статус в кабинете не переписывается
 * второй датой.
 */
export async function answerSupportRequest(ctx: GraphQLContext, id: string): Promise<AdminSupportRequestItem> {
  const viewer = ensureViewer(ctx, "admin.support.answer")
  const existing = await ctx.prisma.supportRequest.findUnique({
    where: { id },
    select: { id: true, topic: true, answeredAt: true }
  })
  if (!existing) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "supportRequest" })
  if (existing.answeredAt) {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "supportRequest",
      expected: "received",
      actual: "answered"
    })
  }

  const updated = await ctx.prisma.supportRequest.update({
    where: { id },
    data: { answeredAt: new Date(), answeredById: viewer.id },
    select: supportSelect
  })

  // Событие #91: тема и статус, без ПДн отправителя и текста ответа — как у #80.
  ctx.logger.log({
    level: "info",
    event: "support.request.answered",
    requestId: ctx.requestId,
    message: "Support request answered",
    data: { topic: updated.topic, status: "answered" }
  })

  return present(updated, "card")
}
