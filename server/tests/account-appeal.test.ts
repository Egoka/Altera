import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import {
  decideAccountAppeal,
  readAccountAppeal,
  submitAccountAppeal,
  type AccountAppealDecision
} from "../src/account/appeal"
import { hashOpaqueToken } from "../src/auth/token-hash"

const now = new Date("2026-09-29T09:00:00.000Z")
const token = "appeal-token"

type AppealStatus = "submitted" | "restored" | "confirmed"

interface AppealRecord {
  id: string
  userId: string
  message: string
  status: AppealStatus
  submittedAt: Date
  decidedAt: Date | null
  decidedByActorId: string | null
  decidedByRole: "admin" | "owner" | null
  decisionReason: string | null
  archivedAt: Date
  reasonCategory: "rules_violation" | "spam_and_manipulation" | "law_or_rights_violation" | "security_threat"
  staffMessage: string | null
  planTier: "free" | "standard" | "pro"
  planUntil: Date | null
}

const archivedUser = () => ({
  id: "user-1",
  email: "reader@example.test",
  locale: "ru" as const,
  role: "author" as const,
  handle: "reader",
  archivedAt: new Date("2026-09-20T12:00:00.000Z"),
  archiveMode: "admin" as const,
  archiveReasonCategory: "spam_and_manipulation" as const,
  archivePublicMessage: "Обнаружена массовая рассылка ссылок.",
  planTier: "standard" as const,
  planUntil: new Date("2026-12-01T00:00:00.000Z")
})

class AppealStore {
  user = archivedUser()
  appeal: AppealRecord | null = null
  audits: Array<Record<string, unknown>> = []

  accountAppealToken = {
    findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) =>
      where.tokenHash === hashOpaqueToken(token)
        ? {
            expiresAt: new Date("2026-09-30T09:00:00.000Z"),
            user: { ...this.user, accountAppeal: this.appeal ? { ...this.appeal } : null }
          }
        : null
    )
  }

  userModel = {
    findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email && where.email !== this.user.email) return null
      if (where.id && where.id !== this.user.id) return null
      return { ...this.user, accountAppeal: this.appeal ? { ...this.appeal } : null }
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (where.id !== this.user.id || !this.user.archivedAt) return { count: 0 }
      Object.assign(this.user, data)
      return { count: 1 }
    })
  }

  accountAppeal = {
    findUnique: vi.fn(async ({ where }: { where: { id?: string; userId?: string } }) => {
      if (!this.appeal) return null
      if (where.id && where.id !== this.appeal.id) return null
      if (where.userId && where.userId !== this.appeal.userId) return null
      return { ...this.appeal, user: { ...this.user } }
    }),
    create: vi.fn(
      async ({
        data
      }: {
        data: Omit<
          AppealRecord,
          "id" | "status" | "submittedAt" | "decidedAt" | "decidedByActorId" | "decidedByRole" | "decisionReason"
        >
      }) => {
        if (this.appeal) {
          const duplicate = new Error("duplicate appeal") as Error & { code: string }
          duplicate.code = "P2002"
          throw duplicate
        }
        this.appeal = {
          id: "appeal-1",
          status: "submitted",
          submittedAt: now,
          decidedAt: null,
          decidedByActorId: null,
          decidedByRole: null,
          decisionReason: null,
          ...data
        }
        return { ...this.appeal }
      }
    ),
    updateMany: vi.fn(
      async ({ where, data }: { where: { id: string; status: AppealStatus }; data: Partial<AppealRecord> }) => {
        if (!this.appeal || this.appeal.id !== where.id || this.appeal.status !== where.status) return { count: 0 }
        Object.assign(this.appeal, data)
        return { count: 1 }
      }
    )
  }

  auditLog = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      this.audits.push(data)
      return { id: `audit-${this.audits.length}`, ...data }
    })
  }

  async $transaction<T>(run: (tx: AppealStore["transactionClient"]) => Promise<T>): Promise<T> {
    return run(this.transactionClient)
  }

  private transactionClient = {
    user: this.userModel,
    accountAppeal: this.accountAppeal,
    auditLog: this.auditLog,
    article: { count: vi.fn().mockResolvedValue(2) }
  }
}

const context = (store: AppealStore, role: "admin" | "owner" | "analyst" | null = null) => {
  const mails: Array<Record<string, unknown>> = []
  return {
    ctx: {
      currentUser: role
        ? { id: `${role}-1`, role, archivedAt: null, permissionExceptions: [], isServiceAccount: true }
        : null,
      requestId: "req-appeal",
      requestMeta: { ip: "203.0.113.10", userAgent: null },
      prisma: {
        accountAppealToken: store.accountAppealToken,
        user: store.userModel,
        accountAppeal: store.accountAppeal,
        auditLog: store.auditLog,
        $transaction: store.$transaction.bind(store)
      },
      rateLimiter: { enforce: vi.fn().mockResolvedValue({ allowed: true, remaining: 9, retryAfter: 3600 }) },
      cache: { delByTags: vi.fn().mockResolvedValue(undefined) },
      logger: { log: vi.fn() },
      mail: {
        send: vi.fn(async (input: Record<string, unknown>) => {
          mails.push(input)
          return { mailId: "mail-1", messageId: "message-1" }
        })
      }
    } as never,
    mails
  }
}

const extensionsOf = async (run: () => Promise<unknown>): Promise<Record<string, unknown>> => {
  try {
    await run()
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(GraphQLError)
    return (error as GraphQLError).extensions as Record<string, unknown>
  }
  throw new Error("Expected GraphQLError")
}

const submit = async (store: AppealStore) =>
  submitAccountAppeal(
    context(store).ctx,
    { token, message: "Прошу пересмотреть решение и проверить материалы ещё раз." },
    now
  )

describe("account appeal by login token", () => {
  it("returns the public blocking category, explanation, staff message and active paid plan without a session", async () => {
    const store = new AppealStore()
    const { ctx } = context(store)

    const result = await readAccountAppeal(ctx, token, now)

    expect(result).toEqual({
      locale: "ru",
      archivedAt: new Date("2026-09-20T12:00:00.000Z"),
      reasonCategory: "spam_and_manipulation",
      explanation: "Массовая рассылка, искусственное продвижение и другие способы накрутки.",
      staffMessage: "Обнаружена массовая рассылка ссылок.",
      plan: { tier: "standard", until: new Date("2026-12-01T00:00:00.000Z") },
      appeal: { id: null, status: "none", submittedAt: null, decidedAt: null },
      canSubmit: true
    })
    expect(ctx.rateLimiter.enforce).toHaveBeenCalledWith("appeal.form.ip", "203.0.113.10", {
      requestId: "req-appeal",
      ip: "203.0.113.10"
    })
  })

  it("rejects an unknown or expired appeal token identically and never exposes an account", async () => {
    const unknown = new AppealStore()
    const expired = new AppealStore()
    expired.accountAppealToken.findUnique.mockResolvedValueOnce({
      expiresAt: new Date("2026-09-29T08:59:59.000Z"),
      user: { ...expired.user, accountAppeal: null }
    })

    for (const [store, presented] of [
      [unknown, "unknown-token"],
      [expired, token]
    ] as const) {
      expect(await extensionsOf(() => readAccountAppeal(context(store).ctx, presented, now))).toMatchObject({
        code: "NOT_FOUND",
        entity: "accountAppeal"
      })
    }
  })

  it("stores one appeal and returns CONFLICT for every repeated submission", async () => {
    const store = new AppealStore()
    const first = await submit(store)

    expect(first).toMatchObject({ id: "appeal-1", status: "submitted", submittedAt: now })
    expect(store.audits).toContainEqual(
      expect.objectContaining({
        action: "user.appeal.submit",
        actorId: null,
        entityType: "user",
        entityId: "user-1",
        diff: { targetId: "user-1", appealId: "appeal-1" }
      })
    )

    expect(await extensionsOf(() => submit(store))).toMatchObject({
      code: "CONFLICT",
      entity: "accountAppeal",
      expected: "none",
      actual: "submitted"
    })
  })

  it.each<[AccountAppealDecision, AppealStatus, boolean]>([
    ["restore", "restored", true],
    ["confirm_block", "confirmed", false]
  ])(
    "lets admin decide %s once, records the audit event and notifies the account",
    async (decision, status, restored) => {
      const store = new AppealStore()
      await submit(store)
      const { ctx, mails } = context(store, "admin")

      const result = await decideAccountAppeal(
        ctx,
        { id: "appeal-1", decision, reason: "Решение принято после повторной проверки." },
        now
      )

      expect(result.appeal.status).toBe(status)
      expect(store.user.archivedAt === null).toBe(restored)
      expect(store.audits).toContainEqual(
        expect.objectContaining({
          action: "user.appeal.decide",
          actorId: "admin-1",
          actorRole: "admin",
          entityType: "user",
          entityId: "user-1",
          diff: {
            targetId: "user-1",
            appealId: "appeal-1",
            decision,
            reason: "Решение принято после повторной проверки."
          }
        })
      )
      expect(mails).toHaveLength(1)
      expect(mails[0]).toMatchObject({
        template: "account_appeal_decision",
        to: "reader@example.test",
        objectType: "accountAppeal",
        objectId: "appeal-1"
      })

      expect(
        await extensionsOf(() => decideAccountAppeal(ctx, { id: "appeal-1", decision, reason: "again" }, now))
      ).toMatchObject({
        code: "CONFLICT",
        entity: "accountAppeal",
        expected: "submitted",
        actual: status
      })
    }
  )

  it("does not let an analyst decide or reveal an internal blocking reason", async () => {
    const store = new AppealStore()
    await submit(store)
    const { ctx } = context(store, "analyst")

    expect(
      await extensionsOf(() => decideAccountAppeal(ctx, { id: "appeal-1", decision: "restore", reason: "ok" }, now))
    ).toMatchObject({
      code: "FORBIDDEN"
    })
    expect(JSON.stringify(await readAccountAppeal(context(store).ctx, token, now))).not.toContain("archiveReason")
  })
})
