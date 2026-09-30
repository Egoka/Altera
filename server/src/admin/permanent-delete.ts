import { Prisma, Role } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import { ensurePermission } from "../exceptions/permissions"
import { handleAdminError } from "../utils/admin"
import type { GraphQLContext } from "../prisma"

/**
 * «Удалить навсегда» (T-076, `docs/spec/10-flows/permanent-delete.md`): необратимое физическое
 * удаление, доступное только `owner`, только из архива, за диалогом с вводом точного имени.
 * Каскад по типу собран из существующих ограничений схемы — Cascade-связи (сессии, версии,
 * ревизии, закладки, замечания) снимаются автоматически при `delete`; связи, которые обязаны
 * пережить удаление (аудит без FK, `HandleHistory`/`*SlugHistory` с `onDelete: SetNull`), сняты
 * из каскада намеренно. Любое непредусмотренное ограничение `Restrict` (например, `PlanGrant`
 * или `ArticleRevision`, где актёр — удаляемый сотрудник на чужом материале) не даёт транзакции
 * дойти до конца: `handleAdminError` превращает `P2003` в `CONFLICT`, а не в необработанный сбой.
 */

export const PERMANENT_DELETE_ENTITIES = ["user", "staff", "article", "section", "tag"] as const
export type PermanentDeleteEntity = (typeof PERMANENT_DELETE_ENTITIES)[number]

const PERSONAL_ROLES: readonly Role[] = ["reader", "author"]

export interface PermanentDeletePreview {
  entityType: PermanentDeleteEntity
  entityId: string
  name: string
  willDelete: string[]
  willKeep: string[]
}

interface DeleteInput {
  entity: PermanentDeleteEntity
  id: string
  confirmedName: string
  reason: string
}

const CASCADE_TEXT: Readonly<Record<PermanentDeleteEntity, { willDelete: string[]; willKeep: string[] }>> = {
  user: {
    willDelete: ["профиль", "сессии", "закладки", "подписки", "статьи со всем их содержимым", "оспаривания"],
    willKeep: ["запись аудита", "агрегаты аналитики без идентификаторов", "хэндл остаётся занятым навсегда"]
  },
  staff: {
    willDelete: ["профиль", "сессии", "исключения доступа"],
    willKeep: ["запись аудита", "история решений, принятых этой записью", "хэндл остаётся занятым навсегда"]
  },
  article: {
    willDelete: ["версии", "ревизии", "медиа обложки", "замечания", "переписка", "закладки на материал"],
    willKeep: ["запись аудита", "адрес (slug) остаётся занятым навсегда"]
  },
  section: {
    willDelete: ["сама рубрика"],
    willKeep: ["запись аудита", "история адресов (slug) остаётся занятой навсегда"]
  },
  tag: {
    willDelete: ["сам тег"],
    willKeep: ["запись аудита", "история адресов (slug) остаётся занятой навсегда"]
  }
}

function requiredText(value: string, field: string, requestId: string): string {
  const text = value.trim()
  if (!text) throw createApiError("VALIDATION_ERROR", { requestId, field, rule: "required" })
  return text
}

function ensureNameMatches(actual: string, confirmed: string, requestId: string): void {
  if (actual.trim() !== confirmed.trim()) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "confirmedName", rule: "exact-match" })
  }
}

interface EntityTarget {
  name: string
}

async function loadUserTarget(
  tx: Prisma.TransactionClient,
  id: string,
  requestId: string,
  kind: "user" | "staff"
): Promise<EntityTarget & { archivedAt: Date | null }> {
  const rows = await tx.$queryRaw<Array<{ id: string; archivedAt: Date | null }>>(Prisma.sql`
    SELECT "id", "archivedAt" FROM "users" WHERE "id" = ${id} FOR UPDATE
  `)
  if (rows.length === 0) throw createApiError("NOT_FOUND", { requestId, entity: "user" })

  const target = await tx.user.findUniqueOrThrow({
    where: { id },
    select: { id: true, name: true, role: true, isServiceAccount: true, archivedAt: true }
  })

  const isStaff = target.isServiceAccount
  if (kind === "user" && (isStaff || !PERSONAL_ROLES.includes(target.role))) {
    throw createApiError("NOT_FOUND", { requestId, entity: "user" })
  }
  if (kind === "staff" && !isStaff) {
    throw createApiError("NOT_FOUND", { requestId, entity: "user" })
  }
  if (kind === "staff" && target.role === "owner") {
    throw createApiError("CONFLICT", { requestId, entity: "user", expected: "not-owner", actual: "owner" })
  }
  if (target.archivedAt === null) {
    throw createApiError("CONFLICT", { requestId, entity: "user", expected: "archived", actual: "active" })
  }
  return { name: target.name, archivedAt: target.archivedAt }
}

async function deleteUserCascade(tx: Prisma.TransactionClient, id: string): Promise<void> {
  // Собственные материалы — со всей их цепочкой (версии/ревизии/медиа обложки/замечания/закладки,
  // снятой Cascade-связями схемы) — уходят раньше самой записи: `Article.author` не каскадный.
  await tx.article.deleteMany({ where: { authorId: id } })
  // Профильные файлы (аватар и любая собственная загрузка) — иначе `MediaAsset.owner` (Restrict)
  // не даст удалить запись.
  await tx.mediaAsset.deleteMany({ where: { ownerId: id } })
  await tx.user.delete({ where: { id } })
}

async function loadArticleTarget(tx: Prisma.TransactionClient, id: string, requestId: string): Promise<EntityTarget> {
  const rows = await tx.$queryRaw<Array<{ id: string; title: string; status: string; firstPublishedAt: Date | null }>>(
    Prisma.sql`SELECT "id", "title", "status"::text, "firstPublishedAt" FROM "articles" WHERE "id" = ${id} FOR UPDATE`
  )
  const target = rows[0]
  if (!target) throw createApiError("NOT_FOUND", { requestId, entity: "article" })
  if (target.status !== "archived" && target.firstPublishedAt !== null) {
    throw createApiError("CONFLICT", { requestId, entity: "article", expected: "archived", actual: target.status })
  }
  return { name: target.title }
}

async function loadTaxonomyTarget(
  tx: Prisma.TransactionClient,
  id: string,
  requestId: string,
  kind: "section" | "tag"
): Promise<EntityTarget> {
  const table = kind === "section" ? "sections" : "tags"
  const rows = await tx.$queryRaw<Array<{ id: string; name: string; status: string; archivedAt: Date | null }>>(
    Prisma.sql`SELECT "id", "name", "status"::text, "archivedAt" FROM ${Prisma.raw(`"${table}"`)} WHERE "id" = ${id} FOR UPDATE`
  )
  const target = rows[0]
  if (!target) throw createApiError("NOT_FOUND", { requestId, entity: kind })
  if (target.status !== "archived" || target.archivedAt === null) {
    throw createApiError("CONFLICT", { requestId, entity: kind, expected: "archived", actual: target.status })
  }
  const articleCount =
    kind === "section"
      ? await tx.article.count({ where: { sectionId: id } })
      : await tx.article.count({ where: { tags: { some: { id } } } })
  if (articleCount > 0) {
    throw createApiError("CONFLICT", { requestId, entity: kind, expected: "no articles", actual: `${articleCount}` })
  }
  return { name: target.name }
}

async function loadTarget(
  ctx: GraphQLContext,
  tx: Prisma.TransactionClient,
  entity: PermanentDeleteEntity,
  id: string
): Promise<EntityTarget> {
  const requestId = ctx.requestId
  switch (entity) {
    case "user":
      return loadUserTarget(tx, id, requestId, "user")
    case "staff":
      return loadUserTarget(tx, id, requestId, "staff")
    case "article":
      return loadArticleTarget(tx, id, requestId)
    case "section":
      return loadTaxonomyTarget(tx, id, requestId, "section")
    case "tag":
      return loadTaxonomyTarget(tx, id, requestId, "tag")
  }
}

async function deleteEntity(tx: Prisma.TransactionClient, entity: PermanentDeleteEntity, id: string): Promise<void> {
  switch (entity) {
    case "user":
    case "staff":
      return deleteUserCascade(tx, id)
    case "article":
      await tx.article.delete({ where: { id } })
      return
    case "section":
      await tx.section.delete({ where: { id } })
      return
    case "tag":
      await tx.tag.delete({ where: { id } })
      return
  }
}

export async function previewPermanentDelete(
  ctx: GraphQLContext,
  entity: PermanentDeleteEntity,
  id: string
): Promise<PermanentDeletePreview> {
  ensurePermission(ctx.currentUser, "owner", "entity.deletePermanently.preview", ctx.requestId)

  const target = await ctx.prisma.$transaction(async (tx) => loadTarget(ctx, tx, entity, id))
  const text = CASCADE_TEXT[entity]
  return { entityType: entity, entityId: id, name: target.name, willDelete: text.willDelete, willKeep: text.willKeep }
}

export async function deletePermanently(ctx: GraphQLContext, input: DeleteInput): Promise<boolean> {
  const actor = ctx.currentUser
  ensurePermission(actor, "owner", "entity.deletePermanently", ctx.requestId)

  const confirmedName = requiredText(input.confirmedName, "confirmedName", ctx.requestId)
  const reason = requiredText(input.reason, "reason", ctx.requestId)

  try {
    await ctx.prisma.$transaction(async (tx) => {
      const target = await loadTarget(ctx, tx, input.entity, input.id)
      ensureNameMatches(target.name, confirmedName, ctx.requestId)

      await deleteEntity(tx, input.entity, input.id)

      await tx.auditLog.create({
        data: {
          action: "entity.delete.permanent",
          actorId: actor!.id,
          actorRole: actor!.role,
          entityType: input.entity,
          entityId: input.id,
          diff: { confirmedName, reason },
          subject: confirmedName,
          requestId: ctx.requestId
        }
      })
    })
  } catch (error) {
    handleAdminError(error, ctx.requestId, input.entity)
  }

  return true
}
