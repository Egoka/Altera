/**
 * T-051, критерии готовности: каждое решение по статье пишет письмо в историю с адресом
 * автора (1), на языке аккаунта (2). Здесь же — ссылка `edit?token=` для доработки и снятия
 * (`routes.md` #68) и устойчивость решения к сбою транспорта (журнал §27).
 */

import { describe, expect, it } from "vitest"
import { createFakeTransport } from "../src/mail/transports/fake"
import { createMailService } from "../src/mail/service"
import {
  notifyArticleDecision,
  type ArticleDecisionKind,
  type ArticleNotificationStore
} from "../src/mail/article-notifications"
import { createMemoryStore } from "./helpers/mail-memory-store"
import type { AppLogger } from "../src/observability/logger"

const now = new Date("2026-09-29T12:00:00.000Z")

function createTranslationStore(authorOverrides: { email?: string; locale?: "ru" | "en" } = {}) {
  const state = {
    id: "translation-1",
    slug: "svet-i-ten",
    title: "Свет и тень",
    editTokenHash: null as string | null,
    editTokenExpiresAt: null as Date | null,
    article: {
      section: { slug: "science" },
      author: { email: authorOverrides.email ?? "author@example.test", locale: authorOverrides.locale ?? "ru" }
    }
  }
  const prisma = {
    articleTranslation: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === state.id ? structuredClone(state) : null,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state, data)
        return structuredClone(state)
      }
    }
  }
  return { store: prisma as unknown as ArticleNotificationStore, state }
}

function createHarness(authorOverrides: { email?: string; locale?: "ru" | "en" } = {}) {
  const { store, state } = createTranslationStore(authorOverrides)
  const { store: mailStore, messages } = createMemoryStore()
  const transport = createFakeTransport()
  const logger: AppLogger = { log: () => undefined }
  const mail = createMailService({ store: mailStore, transport, logger, from: "Altera <no-reply@altera.test>" })
  return { store, state, mail, messages, transport }
}

const DECISIONS: Array<{ decision: ArticleDecisionKind; input: Record<string, unknown>; needsToken: boolean }> = [
  { decision: "published", input: {}, needsToken: false },
  { decision: "ai_rejected", input: {}, needsToken: false },
  { decision: "rework_requested", input: { recommendations: "Добавьте источник" }, needsToken: true },
  { decision: "published_manual", input: {}, needsToken: false },
  { decision: "rejected_final", input: { reason: "Не соответствует правилам" }, needsToken: false },
  { decision: "unpublished", input: { reason: "Жалоба читателя" }, needsToken: true }
]

describe("письма решений по статье (T-051)", () => {
  it.each(DECISIONS)("решение «$decision» пишет письмо в историю с адресом автора", async ({ decision, input }) => {
    const { store, mail, messages } = createHarness()

    await notifyArticleDecision(
      { store, mail },
      { translationId: "translation-1", decision, requestId: "req-1", now, ...input }
    )

    expect(messages.size).toBe(1)
    const [stored] = [...messages.values()]
    expect(stored).toMatchObject({ recipientEmail: "author@example.test", status: "sent" })
  })

  it.each([
    ["ru", "Материал опубликован"],
    ["en", "Your article is published"]
  ] as const)("письмо «опубликовано» уходит на языке аккаунта: %s", async (locale, subject) => {
    const { store, mail, messages } = createHarness({ locale })

    await notifyArticleDecision(
      { store, mail },
      { translationId: "translation-1", decision: "published", requestId: "req-1", now }
    )

    const [stored] = [...messages.values()]
    expect(stored).toMatchObject({ subject })
  })

  it.each(["rework_requested", "unpublished"] as const)(
    "решение «%s» несёт ссылку edit?token= в письме, но не в сохранённой копии",
    async (decision) => {
      const { store, mail, messages, transport } = createHarness()
      const input =
        decision === "rework_requested" ? { recommendations: "Добавьте источник" } : { reason: "Жалоба читателя" }

      await notifyArticleDecision(
        { store, mail },
        { translationId: "translation-1", decision, requestId: "req-1", now, ...input }
      )

      expect(transport.sent).toHaveLength(1)
      const sentText = transport.sent[0]?.text ?? ""
      expect(sentText).toMatch(/\/me\/articles\/translation-1\/edit\?token=[0-9a-f]{64}/)

      const [stored] = [...messages.values()]
      expect(stored?.sanitizedBody).not.toMatch(/token=[0-9a-f]{64}/)
      expect(stored?.sanitizedBody).not.toContain(sentText.match(/token=([0-9a-f]{64})/)?.[1] ?? "\u0000unreachable")
    }
  )

  it("токен ссылки сохраняется на версии с семидневным сроком", async () => {
    const { store, mail, state } = createHarness()

    await notifyArticleDecision(
      { store, mail },
      { translationId: "translation-1", decision: "unpublished", reason: "Жалоба читателя", requestId: "req-1", now }
    )

    expect(state.editTokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(state.editTokenExpiresAt?.toISOString()).toBe("2026-10-06T12:00:00.000Z")
  })

  it("сбой транспорта не бросает наружу: решение выше по стеку уже применено", async () => {
    const { store, mail, transport, messages } = createHarness()
    transport.failWith(new Error("connect ECONNREFUSED"))

    await expect(
      notifyArticleDecision(
        { store, mail },
        { translationId: "translation-1", decision: "published", requestId: "req-1", now }
      )
    ).resolves.toBeUndefined()

    const [stored] = [...messages.values()]
    expect(stored).toMatchObject({ status: "failed" })
  })
})
