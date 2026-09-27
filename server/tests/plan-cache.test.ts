import { describe, expect, it, vi } from "vitest"
import type { AccountPlanGrant } from "../src/account/dashboard"
import { derivePlanCache, derivePlanCacheUpdate, syncPlanCache } from "../src/plans/plan-cache"
import { adminGrantWhere, authorGradeOf, deriveGrantStatus, isBaseGrant } from "../src/plans/plan-state"

// Кэш плана как производная выдач: `role-derivation.md` §2 п. 1–3, п. 6, п. 9; журнал §8.22, §24.1.

const NOW = new Date("2026-09-20T12:00:00.000Z")
const PAST = new Date("2026-08-01T00:00:00.000Z")
const SOON = new Date("2026-10-01T00:00:00.000Z")
const LATER = new Date("2026-12-01T00:00:00.000Z")

const adminGrant = (overrides: Partial<AccountPlanGrant> = {}): AccountPlanGrant => ({
  tier: "standard",
  startsAt: PAST,
  endsAt: SOON,
  revokedAt: null,
  ...overrides
})

const baseGrant = (overrides: Partial<AccountPlanGrant> = {}): AccountPlanGrant => ({
  tier: "standard",
  startsAt: PAST,
  endsAt: null,
  revokedAt: null,
  ...overrides
})

describe("признаки выдачи", () => {
  it("состояние выводится из даты начала, срока и отзыва", () => {
    expect(deriveGrantStatus(adminGrant(), NOW)).toBe("active")
    expect(deriveGrantStatus(adminGrant({ startsAt: LATER, endsAt: null }), NOW)).toBe("queued")
    expect(deriveGrantStatus(adminGrant({ endsAt: PAST }), NOW)).toBe("ended")
    expect(deriveGrantStatus(adminGrant({ revokedAt: PAST }), NOW)).toBe("revoked")
  })

  it("базовая выдача — бессрочная и без выдавшего сотрудника (plan-free.md п. 6а)", () => {
    expect(isBaseGrant({ endsAt: null, grantedById: null })).toBe(true)
    expect(isBaseGrant({ endsAt: SOON, grantedById: "admin-1" })).toBe(false)
    // Срочная выдача без выдавшего и бессрочная от сотрудника базовыми не считаются:
    // `grantPlan` создаёт только срочные и всегда пишет сотрудника.
    expect(isBaseGrant({ endsAt: SOON, grantedById: null })).toBe(false)
    expect(isBaseGrant({ endsAt: null, grantedById: "admin-1" })).toBe(false)
  })

  it("фильтр раздела грантов отсекает ровно базовые выдачи", () => {
    expect(adminGrantWhere()).toEqual({ NOT: { endsAt: null, grantedById: null } })
  })
})

describe("бейдж грейда", () => {
  it("pro показывается только по действующему плану", () => {
    expect(authorGradeOf({ planTier: "pro", planUntil: LATER }, NOW)).toBe("pro")
    expect(authorGradeOf({ planTier: "pro", planUntil: null }, NOW)).toBe("pro")
    expect(authorGradeOf({ planTier: "pro", planUntil: PAST }, NOW)).toBe("standard")
    expect(authorGradeOf({ planTier: "standard", planUntil: LATER }, NOW)).toBe("standard")
    expect(authorGradeOf({ planTier: "free", planUntil: null }, NOW)).toBe("standard")
  })
})

describe("вывод кэша плана из выдач", () => {
  it("без выдач — free без срока", () => {
    expect(derivePlanCache([], NOW)).toEqual({ planTier: "free", planUntil: null })
  })

  it("бессрочная базовая выдача — standard без срока", () => {
    expect(derivePlanCache([baseGrant()], NOW)).toEqual({ planTier: "standard", planUntil: null })
  })

  it("срочная выдача даёт свой уровень и свой срок", () => {
    expect(derivePlanCache([adminGrant({ tier: "pro" })], NOW)).toEqual({ planTier: "pro", planUntil: SOON })
  })

  it("при нескольких действующих выдачах берётся приоритетная (журнал §8.22)", () => {
    const cache = derivePlanCache([baseGrant(), adminGrant({ tier: "pro", endsAt: LATER })], NOW)

    expect(cache).toEqual({ planTier: "pro", planUntil: LATER })
  })

  it("истёкшая и отозванная выдачи плана не дают", () => {
    expect(derivePlanCache([adminGrant({ endsAt: PAST })], NOW)).toEqual({ planTier: "free", planUntil: null })
    expect(derivePlanCache([adminGrant({ revokedAt: PAST })], NOW)).toEqual({ planTier: "free", planUntil: null })
  })

  it("будущая выдача действующим планом ещё не является", () => {
    expect(derivePlanCache([adminGrant({ startsAt: LATER, endsAt: null })], NOW)).toEqual({
      planTier: "free",
      planUntil: null
    })
  })
})

describe("роль в кэше плана", () => {
  it("действующая выдача поднимает читателя до автора (п. 1, 7)", () => {
    expect(derivePlanCacheUpdate({ role: "reader" }, [adminGrant()], NOW)).toEqual({
      role: "author",
      planTier: "standard",
      planUntil: SOON
    })
  })

  it("без действующих выдач автор возвращается к читателю (п. 3)", () => {
    expect(derivePlanCacheUpdate({ role: "author" }, [adminGrant({ revokedAt: PAST })], NOW)).toEqual({
      role: "reader",
      planTier: "free",
      planUntil: null
    })
  })

  it("служебная роль и служебная запись роль по плану не меняют (п. 6)", () => {
    expect(derivePlanCacheUpdate({ role: "editor" }, [adminGrant()], NOW)).toEqual({
      planTier: "standard",
      planUntil: SOON
    })
    expect(derivePlanCacheUpdate({ role: "reader", isServiceAccount: true }, [adminGrant()], NOW)).toEqual({
      planTier: "standard",
      planUntil: SOON
    })
  })
})

describe("запись кэша в транзакции", () => {
  const client = (user: { role: string; isServiceAccount: boolean } | null, grants: AccountPlanGrant[]) => {
    const update = vi.fn().mockResolvedValue({})
    const findMany = vi.fn().mockResolvedValue(grants)
    return {
      update,
      findMany,
      tx: {
        user: { findUnique: vi.fn().mockResolvedValue(user), update },
        planGrant: { findMany }
      } as never
    }
  }

  it("читает выдачи пользователя и пишет посчитанный кэш", async () => {
    const stub = client({ role: "reader", isServiceAccount: false }, [adminGrant({ tier: "pro" })])

    await expect(syncPlanCache(stub.tx, "user-1", NOW)).resolves.toEqual({
      role: "author",
      planTier: "pro",
      planUntil: SOON
    })
    expect(stub.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: { tier: true, startsAt: true, endsAt: true, revokedAt: true }
    })
    expect(stub.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { role: "author", planTier: "pro", planUntil: SOON }
    })
  })

  it("удалённый аккаунт кэша не получает", async () => {
    const stub = client(null, [adminGrant()])

    await expect(syncPlanCache(stub.tx, "gone", NOW)).resolves.toBeNull()
    expect(stub.update).not.toHaveBeenCalled()
  })
})
