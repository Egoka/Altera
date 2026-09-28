import { Prisma, type Locale } from "../generated/prisma"
import type { AiCheckImage, AiCheckReason } from "../ai/types"
import type { GraphQLContext } from "../prisma"

export type ProfileCheckField = "name" | "avatar"

export interface ProfileCheckInput {
  userId: string
  field: ProfileCheckField
  locale: Locale
  value: string
  versionId: string
  images?: readonly AiCheckImage[]
}

export interface ProfileCheckOutcome {
  status: "ok" | "pending"
  verdict: "ok" | "needs_review" | null
  model: string
  promptVersion: string
  reasons: readonly AiCheckReason[]
  providerErrorClass: string | null
}

export async function runAutomaticProfileCheck(
  ctx: GraphQLContext,
  input: ProfileCheckInput
): Promise<ProfileCheckOutcome> {
  try {
    const result = await ctx.aiCheck.check({
      translationId: `profile:${input.userId}:${input.field}`,
      revisionId: input.versionId,
      locale: input.locale,
      title: input.field === "name" ? input.value : "Profile avatar",
      dek: null,
      blocks: input.field === "name" ? input.value : "",
      sectionSlug: null,
      tags: [],
      images: input.images ?? [],
      adultMarkedByAuthor: false
    })
    return {
      status: result.verdict === "publish" ? "ok" : "pending",
      verdict: result.verdict === "publish" ? "ok" : "needs_review",
      model: result.model,
      promptVersion: result.promptVersion,
      reasons: result.reasons,
      providerErrorClass: null
    }
  } catch (error: unknown) {
    ctx.logger?.log({
      level: "warn",
      event: "backend.error",
      requestId: ctx.requestId,
      message: `Profile ${input.field} automatic check is unavailable`,
      error
    })
    return {
      status: "pending",
      verdict: null,
      model: ctx.aiCheck.model,
      promptVersion: ctx.aiCheck.promptVersion,
      reasons: [],
      providerErrorClass: error instanceof Error ? error.name : "UnknownError"
    }
  }
}

export async function persistAutomaticProfileCheck(
  tx: Prisma.TransactionClient,
  ctx: GraphQLContext,
  input: ProfileCheckInput,
  outcome: ProfileCheckOutcome
): Promise<void> {
  const reasons = outcome.reasons.map((reason) => ({ category: reason.category, text: reason.text }))
  await tx.aiProcess.create({
    data: {
      kind: "profile",
      status: outcome.providerErrorClass ? "failed" : "completed",
      objectType: `profile.${input.field}`,
      objectId: input.userId,
      revisionId: input.versionId,
      model: outcome.model,
      promptVersion: outcome.promptVersion,
      verdict: outcome.verdict,
      reasons: reasons.length ? reasons : Prisma.DbNull,
      providerErrorClass: outcome.providerErrorClass,
      startedAt: new Date(),
      finishedAt: new Date()
    }
  })
  await tx.auditLog.create({
    data: {
      action: "profile.check",
      actorId: null,
      actorRole: null,
      entityType: "user",
      entityId: input.userId,
      diff: {
        userId: input.userId,
        field: input.field,
        verdict: outcome.verdict,
        byRole: "system",
        checkedVersion: input.versionId,
        model: outcome.model,
        promptVersion: outcome.promptVersion,
        reasons,
        providerErrorClass: outcome.providerErrorClass
      },
      requestId: ctx.requestId
    }
  })
}
