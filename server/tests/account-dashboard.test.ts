import { addDays, subDays } from "date-fns"
import { describe, expect, it, vi } from "vitest"
import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import { buildASTSchema, isEnumType, isObjectType } from "graphql"
import path from "path"
import resolver from "../src/graphql/account/resolver"
import { deriveAccountSubscription, type AccountPlanGrant } from "../src/account/dashboard"

/**
 * Сводка кабинета `/me` (`docs/spec/30-account/reader/dashboard.md`): карточка плана выводится
 * из выдач (§5 зона 3, журнал §8.22, §25.1), данные отдаются только владельцу (§2, §4), служебная
 * запись плана не получает (§8.17, §25.2).
 */

const NOW = new Date("2026-09-21T12:00:00.000Z")

const grant = (overrides: Partial<AccountPlanGrant> = {}): AccountPlanGrant => ({
  tier: "standard",
  startsAt: subDays(NOW, 10),
  endsAt: addDays(NOW, 20),
  revokedAt: null,
  ...overrides
})

describe("deriveAccountSubscription", () => {
  it("shows the free first-run plan for an account without grants", () => {
    expect(deriveAccountSubscription([], NOW)).toEqual({
      state: "free",
      tier: "free",
      until: null,
      endedAt: null,
      queue: []
    })
  })

  it("treats the lifelong grant as the base plan without an end date", () => {
    const view = deriveAccountSubscription([grant({ endsAt: null })], NOW)

    expect(view).toMatchObject({ state: "base", tier: "standard", until: null, queue: [] })
  })

  it("shows the active grant with its end date", () => {
    const view = deriveAccountSubscription([grant({ tier: "pro" })], NOW)

    expect(view).toMatchObject({ state: "active", tier: "pro", until: addDays(NOW, 20) })
  })

  it("runs pro ahead of standard and queues the rest (§8.22)", () => {
    const view = deriveAccountSubscription(
      [
        grant({ tier: "standard", endsAt: addDays(NOW, 40) }),
        grant({ tier: "pro", endsAt: addDays(NOW, 5) }),
        grant({ tier: "pro", startsAt: addDays(NOW, 50), endsAt: addDays(NOW, 80) })
      ],
      NOW
    )

    expect(view.state).toBe("active")
    expect(view.tier).toBe("pro")
    expect(view.until).toEqual(addDays(NOW, 5))
    expect(view.queue.map((period) => period.tier)).toEqual(["standard", "pro"])
  })

  it("reports an expired plan when the last grant ended", () => {
    const view = deriveAccountSubscription([grant({ startsAt: subDays(NOW, 40), endsAt: subDays(NOW, 2) })], NOW)

    expect(view).toMatchObject({ state: "expired", tier: "free", endedAt: subDays(NOW, 2) })
  })

  it("reports a revoked plan as expired at the revocation time", () => {
    const view = deriveAccountSubscription([grant({ revokedAt: subDays(NOW, 1) })], NOW)

    expect(view).toMatchObject({ state: "expired", endedAt: subDays(NOW, 1) })
  })

  it("ignores a grant revoked before it started", () => {
    const view = deriveAccountSubscription(
      [grant({ startsAt: addDays(NOW, 5), endsAt: addDays(NOW, 30), revokedAt: subDays(NOW, 1) })],
      NOW
    )

    expect(view.state).toBe("free")
  })

  it("keeps a future grant in the queue while nothing is active", () => {
    const view = deriveAccountSubscription([grant({ startsAt: addDays(NOW, 3), endsAt: addDays(NOW, 33) })], NOW)

    expect(view.state).toBe("free")
    expect(view.queue).toEqual([{ tier: "standard", startsAt: addDays(NOW, 3), endsAt: addDays(NOW, 33) }])
  })
})

interface ContextOptions {
  role?: "reader" | "author" | "editor" | "admin"
  isServiceAccount?: boolean
  archivedAt?: Date | null
  grants?: AccountPlanGrant[]
  article?: { id: string } | null
  signedIn?: boolean
}

function context(options: ContextOptions = {}) {
  const findMany = vi.fn(async () => options.grants ?? [])
  const findFirst = vi.fn(async () => (options.article === undefined ? null : options.article))
  const currentUser =
    options.signedIn === false
      ? null
      : {
          id: "user-1",
          role: options.role ?? "reader",
          isServiceAccount: options.isServiceAccount ?? false,
          archivedAt: options.archivedAt ?? null
        }

  return {
    ctx: {
      currentUser,
      requestId: "req-t030",
      prisma: { planGrant: { findMany }, article: { findFirst } }
    } as never,
    findMany,
    findFirst
  }
}

const own = { id: "user-1" }

describe("AccountUser dashboard fields", () => {
  it("returns the ISO plan view for the owner", async () => {
    const { ctx } = context({ grants: [grant({ tier: "pro", startsAt: subDays(NOW, 1), endsAt: addDays(NOW, 365) })] })

    const result = await resolver.AccountUser.subscription(own, {}, ctx)

    expect(result?.state).toBe("active")
    expect(result?.tier).toBe("pro")
    expect(typeof result?.until).toBe("string")
  })

  it("gives a service record no plan (§8.17, §25.2)", async () => {
    const { ctx, findMany } = context({ role: "admin", isServiceAccount: true })

    expect(await resolver.AccountUser.subscription(own, {}, ctx)).toBeNull()
    expect(findMany).not.toHaveBeenCalled()
  })

  it("answers FORBIDDEN to a restricted self-archived session", async () => {
    const { ctx } = context({ archivedAt: subDays(NOW, 1) })

    await expect(resolver.AccountUser.subscription(own, {}, ctx)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" }
    })
    await expect(resolver.AccountUser.hasArticles(own, {}, ctx)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" }
    })
  })

  it("does not reveal another account's plan or articles", async () => {
    const { ctx, findMany, findFirst } = context()

    await expect(resolver.AccountUser.subscription({ id: "user-2" }, {}, ctx)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" }
    })
    await expect(resolver.AccountUser.hasArticles({ id: "user-2" }, {}, ctx)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" }
    })
    expect(findMany).not.toHaveBeenCalled()
    expect(findFirst).not.toHaveBeenCalled()
  })

  it("answers UNAUTHENTICATED without a session", async () => {
    const { ctx } = context({ signedIn: false })

    await expect(resolver.AccountUser.hasArticles(own, {}, ctx)).rejects.toMatchObject({
      extensions: { code: "UNAUTHENTICATED" }
    })
  })

  it("reports whether the account has written anything", async () => {
    expect(await resolver.AccountUser.hasArticles(own, {}, context({ article: null }).ctx)).toBe(false)

    const { ctx, findFirst } = context({ article: { id: "article-1" } })
    expect(await resolver.AccountUser.hasArticles(own, {}, ctx)).toBe(true)
    expect(findFirst).toHaveBeenCalledWith({ where: { authorId: "user-1" }, select: { id: true } })
  })
})

describe("dashboard GraphQL contract", () => {
  const schema = buildASTSchema(
    mergeTypeDefs(loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] }))
  )

  it("exposes the plan states the card renders and no payment fields", () => {
    const state = schema.getType("AccountPlanState")
    expect(isEnumType(state)).toBe(true)
    if (isEnumType(state)) {
      expect(state.getValues().map((value) => value.name)).toEqual(["free", "base", "active", "expired"])
    }

    const subscription = schema.getType("AccountSubscription")
    expect(isObjectType(subscription)).toBe(true)
    if (isObjectType(subscription)) {
      expect(Object.keys(subscription.getFields()).sort()).toEqual(["endedAt", "queue", "state", "tier", "until"])
    }
  })

  it("adds the dashboard fields to the own account", () => {
    const user = schema.getType("AccountUser")
    expect(isObjectType(user)).toBe(true)
    if (isObjectType(user)) {
      expect(user.getFields().hasArticles?.type.toString()).toBe("Boolean!")
      expect(user.getFields().subscription?.type.toString()).toBe("AccountSubscription")
    }
  })
})
