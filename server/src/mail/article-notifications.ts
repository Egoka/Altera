/**
 * Письма автору о решениях по статье (T-051, журнал #14, #43, §20.10–11): автопубликация,
 * отказ AI, запрос доработки, ручная публикация, окончательный отказ, снятие с публикации.
 * Вызывается из уже свершившихся переходов T-049 после их транзакции — ошибка транспорта не
 * должна откатывать применённое решение (журнал §27, `mail/service.ts` сама пишет `mail.failed`
 * и историю письма).
 */

import crypto from "node:crypto"
import { addDays } from "date-fns"
import { hashOpaqueToken } from "../auth/token-hash"
import type { Locale, PrismaClient } from "../generated/prisma"
import type { MailService } from "./service"
import {
  ARTICLE_AI_REJECTED_TEMPLATE,
  ARTICLE_PUBLISHED_MANUAL_TEMPLATE,
  ARTICLE_PUBLISHED_TEMPLATE,
  ARTICLE_REJECTED_FINAL_TEMPLATE,
  ARTICLE_REWORK_REQUESTED_TEMPLATE,
  ARTICLE_UNPUBLISHED_TEMPLATE,
  createArticleAiRejectedMessage,
  createArticlePublishedManualMessage,
  createArticlePublishedMessage,
  createArticleRejectedFinalMessage,
  createArticleReworkRequestedMail,
  createArticleUnpublishedMail,
  type MailMessage
} from "./messages"

const ARTICLE_OBJECT_TYPE = "ArticleTranslation"

/** [ДОПУЩЕНИЕ] Срок ссылки `edit?token=` (`routes.md` #68, `moderation.md` §8) — семь дней. */
export const ARTICLE_EDIT_TOKEN_EXPIRY_DAYS = 7

export type ArticleDecisionKind =
  | "published"
  | "ai_rejected"
  | "rework_requested"
  | "published_manual"
  | "rejected_final"
  | "unpublished"

export interface NotifyArticleDecisionInput {
  translationId: string
  decision: ArticleDecisionKind
  reason?: string | null
  recommendations?: string | null
  requestId: string
  now?: Date
}

export type ArticleNotificationStore = Pick<PrismaClient, "articleTranslation">

export interface ArticleNotificationDeps {
  store: ArticleNotificationStore
  mail: MailService
}

/** Тот же приём, что и в `account/archive.ts`: страница живёт на домене писем входа. */
const frontendOrigin = (): string =>
  process.env.FRONTEND_URL || new URL(process.env.MAGIC_LINK_BASE_URL || "http://localhost:3000/auth/verify").origin

const localePath = (locale: Locale, path: string): string => (locale === "en" ? `/en${path}` : path)

const buildUrl = (locale: Locale, path: string): string =>
  new URL(localePath(locale, path), frontendOrigin()).toString()

const buildArticleEditUrl = (locale: Locale, translationId: string, token: string): string => {
  const url = new URL(localePath(locale, `/me/articles/${translationId}/edit`), frontendOrigin())
  url.searchParams.set("token", token)
  return url.toString()
}

async function issueArticleEditToken(
  store: ArticleNotificationStore,
  translationId: string,
  now: Date
): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex")
  await store.articleTranslation.update({
    where: { id: translationId },
    data: {
      editTokenHash: hashOpaqueToken(token),
      editTokenExpiresAt: addDays(now, ARTICLE_EDIT_TOKEN_EXPIRY_DAYS)
    }
  })
  return token
}

const ARTICLE_NOTIFICATION_SELECT = {
  id: true,
  slug: true,
  title: true,
  article: {
    select: {
      section: { select: { slug: true } },
      author: { select: { email: true, locale: true } }
    }
  }
} as const

interface DecisionContent {
  template: string
  message: MailMessage
  sanitizedBody: string
}

function buildContent(
  decision: ArticleDecisionKind,
  locale: Locale,
  title: string,
  publicUrl: string,
  reviewHistoryUrl: string,
  editUrl: string | null,
  reason: string | null,
  recommendations: string | null
): DecisionContent {
  switch (decision) {
    case "published": {
      const message = createArticlePublishedMessage(locale, title, publicUrl)
      return { template: ARTICLE_PUBLISHED_TEMPLATE, message, sanitizedBody: message.text }
    }
    case "ai_rejected": {
      const message = createArticleAiRejectedMessage(locale, title, reviewHistoryUrl)
      return { template: ARTICLE_AI_REJECTED_TEMPLATE, message, sanitizedBody: message.text }
    }
    case "published_manual": {
      const message = createArticlePublishedManualMessage(locale, title, publicUrl)
      return { template: ARTICLE_PUBLISHED_MANUAL_TEMPLATE, message, sanitizedBody: message.text }
    }
    case "rejected_final": {
      const message = createArticleRejectedFinalMessage(locale, title, reason, reviewHistoryUrl)
      return { template: ARTICLE_REJECTED_FINAL_TEMPLATE, message, sanitizedBody: message.text }
    }
    case "rework_requested": {
      const { message, sanitizedBody } = createArticleReworkRequestedMail(
        locale,
        title,
        recommendations ?? "",
        editUrl ?? ""
      )
      return { template: ARTICLE_REWORK_REQUESTED_TEMPLATE, message, sanitizedBody }
    }
    case "unpublished": {
      const { message, sanitizedBody } = createArticleUnpublishedMail(locale, title, reason ?? "", editUrl ?? "")
      return { template: ARTICLE_UNPUBLISHED_TEMPLATE, message, sanitizedBody }
    }
  }
}

const EDIT_LINK_DECISIONS = new Set<ArticleDecisionKind>(["rework_requested", "unpublished"])

/**
 * Отправляет письмо решения и пишет его в историю писем с адресом автора (журнал §27). Сбой
 * отправки не бросает наружу: решение уже применено выше по стеку, откатывать его нечем.
 */
export async function notifyArticleDecision(
  deps: ArticleNotificationDeps,
  input: NotifyArticleDecisionInput
): Promise<void> {
  const { store, mail } = deps
  const now = input.now ?? new Date()

  const translation = await store.articleTranslation.findUnique({
    where: { id: input.translationId },
    select: ARTICLE_NOTIFICATION_SELECT
  })
  if (!translation) return

  const { author } = translation.article
  const locale = author.locale
  const sectionSlug = translation.article.section?.slug ?? ""
  const publicUrl = buildUrl(locale, `/${sectionSlug}/${translation.slug}`)
  const reviewHistoryUrl = buildUrl(locale, `/me/articles/${translation.id}/review`)
  const editUrl = EDIT_LINK_DECISIONS.has(input.decision)
    ? buildArticleEditUrl(locale, translation.id, await issueArticleEditToken(store, translation.id, now))
    : null

  const content = buildContent(
    input.decision,
    locale,
    translation.title,
    publicUrl,
    reviewHistoryUrl,
    editUrl,
    input.reason ?? null,
    input.recommendations ?? null
  )

  try {
    await mail.send({
      template: content.template,
      to: author.email,
      content: content.message,
      sanitizedBody: content.sanitizedBody,
      objectType: ARTICLE_OBJECT_TYPE,
      objectId: translation.id,
      requestId: input.requestId
    })
  } catch (error: unknown) {
    // `mail.send` уже записала `mail.failed` и историю письма — второй раз бросать нечего.
    void error
  }
}
