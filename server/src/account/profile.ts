import { authorCacheTag } from "../cache"
import { createApiError } from "../errors/graphql-error"
import { ensureAuthenticated, ensurePermission } from "../exceptions/permissions"
import { Prisma, type Locale } from "../generated/prisma"
import type { GraphQLContext } from "../prisma"
import { persistAutomaticProfileCheck, runAutomaticProfileCheck } from "./profile-check"

const HANDLE_PATTERN = /^[a-z0-9-]{3,32}$/
const UPDATE_ACTION = "profile.update"
const REVIEW_ACTION = "profile.review.decide"

export interface ProfileInput {
  name: string
  handle: string
  bio?: string | null
  socialLinks?: unknown
  locale: Locale
}

function ensureProfileOwner(ctx: GraphQLContext) {
  const user = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  if (user.archivedAt || user.isServiceAccount) {
    throw createApiError("FORBIDDEN", { requestId: ctx.requestId, action: UPDATE_ACTION })
  }
  return user
}

function normalizeHandle(value: string, requestId: string): string {
  const handle = value.trim()
  if (!HANDLE_PATTERN.test(handle)) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "handle", rule: "format" })
  }
  return handle
}

function normalizeName(value: string, requestId: string): string {
  const name = value.trim()
  if (!name) throw createApiError("VALIDATION_ERROR", { requestId, field: "name", rule: "required" })
  return name
}

function normalizeLinks(value: unknown, requestId: string): Record<string, string> | null {
  if (value == null) return null
  if (typeof value !== "object" || Array.isArray(value)) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "socialLinks", rule: "format" })
  }
  const links: Record<string, string> = {}
  for (const [kind, raw] of Object.entries(value)) {
    if (typeof raw !== "string" || !raw.trim()) continue
    try {
      const url = new URL(raw.trim())
      if (url.protocol !== "https:") throw new Error("protocol")
      links[kind] = url.toString()
    } catch {
      throw createApiError("VALIDATION_ERROR", { requestId, field: "socialLinks", rule: "url" })
    }
  }
  return Object.keys(links).length ? links : null
}

export async function checkHandle(ctx: GraphQLContext, value: string) {
  const user = ensureProfileOwner(ctx)
  const handle = normalizeHandle(value, ctx.requestId)
  const existing = await ctx.prisma.handleHistory.findUnique({ where: { handle }, select: { userId: true } })
  return { handle, available: !existing || existing.userId === user.id }
}

export async function updateProfile(ctx: GraphQLContext, input: ProfileInput) {
  const user = ensureProfileOwner(ctx)
  await ctx.rateLimiter.enforce("account.mutation.user", user.id, {
    requestId: ctx.requestId,
    ip: ctx.requestMeta?.ip
  })

  const current = await ctx.prisma.user.findUnique({ where: { id: user.id } })
  if (!current) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "user" })

  const handle = normalizeHandle(input.handle, ctx.requestId)
  const name = normalizeName(input.name, ctx.requestId)
  const links = normalizeLinks(input.socialLinks, ctx.requestId)
  const handleRecord = await ctx.prisma.handleHistory.findUnique({ where: { handle }, select: { userId: true } })
  if (handleRecord && handleRecord.userId !== user.id) {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "handle",
      expected: "available",
      actual: "taken"
    })
  }

  const nameChanged = name !== current.name && name !== current.pendingName
  const checkInput = {
    userId: user.id,
    field: "name" as const,
    locale: input.locale,
    value: name,
    versionId: ctx.requestId
  }
  const nameResult = nameChanged ? await runAutomaticProfileCheck(ctx, checkInput) : null
  const automaticStatus = nameResult?.status ?? null
  const changedHandle = handle !== current.handle
  const now = new Date()

  try {
    const updated = await ctx.prisma.$transaction(async (tx) => {
      if (changedHandle && !handleRecord) {
        await tx.handleHistory.create({ data: { handle, userId: user.id } })
      }
      const result = await tx.user.update({
        where: { id: user.id },
        data: {
          handle,
          handleConfirmed: true,
          handleChangedAt: changedHandle ? now : current.handleChangedAt,
          bio: input.bio?.trim() || null,
          socialLinks: links ?? Prisma.DbNull,
          locale: input.locale,
          ...(automaticStatus === "ok"
            ? { name, pendingName: null, nameCheckStatus: "ok" as const, nameCheckReason: null }
            : automaticStatus === "pending"
              ? { pendingName: name, nameCheckStatus: "pending" as const, nameCheckReason: null }
              : {})
        }
      })
      if (nameResult) {
        await persistAutomaticProfileCheck(tx, ctx, checkInput, nameResult)
      }
      return result
    })
    await ctx.cache.delByTags([authorCacheTag(current.handle), authorCacheTag(handle), "home"])
    return updated
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "handle",
        expected: "available",
        actual: "taken"
      })
    }
    throw error
  }
}

export interface ProfileReviewInput {
  userId: string
  field: "name"
  verdict: "approve" | "reject"
  reason?: string | null
}

export async function decideProfileCheck(ctx: GraphQLContext, input: ProfileReviewInput) {
  const actor = ensureAuthenticated(ctx.currentUser, ctx.requestId)
  ensurePermission(actor, "moderate", REVIEW_ACTION, ctx.requestId)
  const target = await ctx.prisma.user.findUnique({ where: { id: input.userId } })
  if (!target) throw createApiError("NOT_FOUND", { requestId: ctx.requestId, entity: "user" })
  if (target.nameCheckStatus !== "pending" || !target.pendingName) {
    throw createApiError("CONFLICT", {
      requestId: ctx.requestId,
      entity: "profileCheck",
      expected: "pending",
      actual: target.nameCheckStatus
    })
  }
  const reason = input.reason?.trim() || null
  if (input.verdict === "reject" && !reason) {
    throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: "reason", rule: "required" })
  }
  await ctx.prisma.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: { id: target.id, pendingName: target.pendingName, nameCheckStatus: "pending" },
      data:
        input.verdict === "approve"
          ? { name: target.pendingName!, pendingName: null, nameCheckStatus: "ok", nameCheckReason: null }
          : { pendingName: null, nameCheckStatus: "rejected", nameCheckReason: reason }
    })
    if (result.count !== 1) {
      throw createApiError("CONFLICT", {
        requestId: ctx.requestId,
        entity: "profileCheck",
        expected: "pendingVersion",
        actual: "changed"
      })
    }
    await tx.auditLog.create({
      data: {
        action: "profile.check",
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "user",
        entityId: target.id,
        diff: {
          userId: target.id,
          field: "name",
          verdict: input.verdict === "approve" ? "ok" : "rejected",
          byRole: actor.role,
          reason
        },
        requestId: ctx.requestId
      }
    })
  })
  await ctx.cache.delByTags([authorCacheTag(target.handle), "home"])
  return ctx.prisma.user.findUnique({ where: { id: target.id } })
}
