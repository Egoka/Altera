import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import { checkHandle, updateProfile } from "../src/account/profile"
import type { GraphQLContext } from "../src/prisma"
import { createTestRateLimiter } from "./helpers/rate-limit"

interface MemoryUser {
  id: string
  name: string
  pendingName: string | null
  nameCheckStatus: "ok" | "pending" | "rejected"
  nameCheckReason: string | null
  handle: string
  handleConfirmed: boolean
  handleChangedAt: Date | null
  bio: string | null
  socialLinks: unknown
  locale: "ru" | "en"
  role: "reader"
  archivedAt: Date | null
  isServiceAccount: boolean
  planTier: "free"
  planUntil: Date | null
}

const user = (overrides: Partial<MemoryUser> = {}): MemoryUser => ({
  id: "user-1",
  name: "Старое имя",
  pendingName: null,
  nameCheckStatus: "ok",
  nameCheckReason: null,
  handle: "old-handle",
  handleConfirmed: false,
  handleChangedAt: null,
  bio: null,
  socialLinks: null,
  locale: "ru",
  role: "reader",
  archivedAt: null,
  isServiceAccount: false,
  planTier: "free",
  planUntil: null,
  ...overrides
})

function createContext(actor = user(), verdict: "publish" | "reject" = "publish") {
  const handles = new Map<string, string | null>([[actor.handle, actor.id]])
  const audits: Record<string, unknown>[] = []
  const aiProcesses: Record<string, unknown>[] = []
  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; handle?: string } }) => {
        if (where.id === actor.id || where.handle === actor.handle) return { ...actor }
        return null
      }),
      update: vi.fn(async ({ data }: { data: Partial<MemoryUser> }) => {
        Object.assign(actor, data)
        return { ...actor }
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Partial<MemoryUser>; data: Partial<MemoryUser> }) => {
        const matches =
          (!where.id || where.id === actor.id) &&
          (!("pendingName" in where) || where.pendingName === actor.pendingName) &&
          (!("nameCheckStatus" in where) || where.nameCheckStatus === actor.nameCheckStatus)
        if (!matches) return { count: 0 }
        Object.assign(actor, data)
        return { count: 1 }
      })
    },
    aiProcess: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        aiProcesses.push(data)
        return data
      })
    },
    handleHistory: {
      findUnique: vi.fn(async ({ where }: { where: { handle: string } }) => {
        const owner = handles.get(where.handle)
        return owner === undefined ? null : { handle: where.handle, userId: owner }
      }),
      create: vi.fn(async ({ data }: { data: { handle: string; userId: string } }) => {
        if (handles.has(data.handle)) throw new Error("unique")
        handles.set(data.handle, data.userId)
        return data
      })
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data)
        return data
      })
    }
  }
  const transaction = vi.fn(async (run: (tx: typeof prisma) => Promise<unknown>) => run(prisma))
  const aiCheck = {
    name: "fake",
    model: "fake-check",
    promptVersion: "fake-1",
    check: vi.fn(async () => ({
      verdict,
      reasons: verdict === "reject" ? [{ category: "topic_rules", text: "Нужна проверка" }] : [],
      evidence: [],
      manipulationAttempt: false,
      adult: false,
      model: "fake-check",
      promptVersion: "fake-1",
      costMinor: 0
    }))
  }
  const ctx = {
    prisma: { ...prisma, $transaction: transaction },
    currentUser: actor,
    requestId: "request-1",
    requestMeta: { ip: "203.0.113.10", userAgent: null },
    rateLimiter: createTestRateLimiter(),
    aiCheck,
    cache: { delByTags: vi.fn() }
  } as unknown as GraphQLContext

  return { ctx, actor, handles, audits, aiProcesses, aiCheck }
}

describe("T-031 profile editing", () => {
  it("normalizes and permanently reserves a changed handle", async () => {
    const { ctx, actor, handles } = createContext()

    await updateProfile(ctx, { handle: "  new-handle  ", name: actor.name, locale: "en" })

    expect(actor.handle).toBe("new-handle")
    expect(actor.handleConfirmed).toBe(true)
    expect(actor.handleChangedAt).toBeInstanceOf(Date)
    expect(handles.get("new-handle")).toBe("user-1")
    expect(handles.get("old-handle")).toBe("user-1")
  })

  it("reports an unavailable historical handle without changing the account", async () => {
    const { ctx, actor, handles } = createContext()
    handles.set("used-before", null)

    await expect(checkHandle(ctx, "used-before")).resolves.toEqual({ handle: "used-before", available: false })
    await expect(updateProfile(ctx, { handle: "used-before", name: actor.name, locale: "ru" })).rejects.toMatchObject<
      Partial<GraphQLError>
    >({ extensions: { code: "CONFLICT", entity: "handle" } })
    expect(actor.handle).toBe("old-handle")
  })

  it("applies a name immediately when the T-048 adapter accepts it", async () => {
    const { ctx, actor, audits, aiProcesses, aiCheck } = createContext()

    await updateProfile(ctx, { handle: actor.handle, name: "Новое имя", locale: "ru" })

    expect(aiCheck.check).toHaveBeenCalledWith(expect.objectContaining({ translationId: "profile:user-1:name" }))
    expect(actor.name).toBe("Новое имя")
    expect(actor.pendingName).toBeNull()
    expect(actor.nameCheckStatus).toBe("ok")
    expect(aiProcesses).toEqual([expect.objectContaining({ status: "completed", verdict: "ok" })])
    expect(audits[0]).toMatchObject({
      action: "profile.check",
      actorId: null,
      actorRole: null,
      diff: { userId: actor.id, field: "name", verdict: "ok", byRole: "system" }
    })
  })

  it("keeps the public name and sends a rejected automatic result to manual review", async () => {
    const { ctx, actor, audits, aiProcesses } = createContext(user(), "reject")

    await updateProfile(ctx, { handle: actor.handle, name: "Спорное имя", locale: "ru" })

    expect(actor.name).toBe("Старое имя")
    expect(actor.pendingName).toBe("Спорное имя")
    expect(actor.nameCheckStatus).toBe("pending")
    expect(actor.nameCheckReason).toBeNull()
    expect(aiProcesses).toEqual([expect.objectContaining({ status: "completed", verdict: "needs_review" })])
    expect(audits[0]).toMatchObject({
      diff: { userId: actor.id, field: "name", verdict: "needs_review", byRole: "system" }
    })
  })

  it("keeps a name change pending when the automatic checker is unavailable", async () => {
    const { ctx, actor, aiCheck, aiProcesses } = createContext()
    aiCheck.check.mockRejectedValueOnce(new Error("provider unavailable"))

    await updateProfile(ctx, { handle: actor.handle, name: "Имя на проверке", locale: "ru" })

    expect(actor.name).toBe("Старое имя")
    expect(actor.pendingName).toBe("Имя на проверке")
    expect(actor.nameCheckStatus).toBe("pending")
    expect(aiProcesses).toEqual([
      expect.objectContaining({
        objectType: "profile.name",
        status: "failed",
        verdict: null,
        providerErrorClass: "Error"
      })
    ])
  })

  it.each(["UPPER", "a_underscore", "ab", "a".repeat(33)])("rejects invalid handle %s", async (handle) => {
    const { ctx, actor } = createContext()

    await expect(updateProfile(ctx, { handle, name: actor.name, locale: "ru" })).rejects.toMatchObject<
      Partial<GraphQLError>
    >({ extensions: { code: "VALIDATION_ERROR", field: "handle", rule: "format" } })
  })
})
