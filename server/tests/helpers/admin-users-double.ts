import { vi } from "vitest"
import type { GraphQLContext } from "../../src/prisma"

/**
 * Двойник Prisma для раздела «Пользователи» (`server/src/admin/users.ts`). Он знает ровно те
 * операции, которые делает раздел: выборку обычных аккаунтов с фильтрами, агрегаты статей и
 * сессий, выдачи плана, согласия, журнал аудита и транзакцию. Живая база нужна отдельному набору
 * `admin-users-database.test.ts`; здесь проверяются правила, а не SQL.
 */

export type MemoryRole = "reader" | "author" | "editor" | "moderator" | "analyst" | "admin" | "owner"

export interface MemoryUser {
  id: string
  name: string
  handle: string
  email: string
  role: MemoryRole
  locale: string
  nameCheckStatus: string
  avatarCheckStatus: string
  isServiceAccount: boolean
  createdAt: Date
  archivedAt: Date | null
  archiveMode: string | null
  archivedByActorId: string | null
  archivedByRole: MemoryRole | null
  archiveReason: string | null
  archiveReasonCategory: string | null
  archivePublicMessage: string | null
  planTier: "free" | "standard" | "pro"
  planUntil: Date | null
}

export interface MemoryArticle {
  id: string
  authorId: string
  slug: string
  title: string
  status: string
  sourceLocale: string
  createdAt: Date
  publishedAt: Date | null
  archivedAt: Date | null
  archivedByActorId: string | null
  archivedByRole: MemoryRole | null
  archiveReason: string | null
}

export interface MemorySession {
  id: string
  userId: string
  createdAt: Date
  lastUsedAt: Date
  expiresAt: Date
  revokedAt: Date | null
  userAgent: string | null
}

export interface MemoryGrant {
  id: string
  userId: string
  tier: "free" | "standard" | "pro"
  startsAt: Date
  endsAt: Date | null
  grantedById: string | null
  revokedAt: Date | null
}

export interface MemoryConsent {
  userId: string
  acceptedAt: Date
  legalText: { kind: string; version: number; locale: string }
}

export const memoryUser = (overrides: Partial<MemoryUser> & { id: string }): MemoryUser => ({
  name: `Читатель ${overrides.id}`,
  handle: overrides.id,
  email: `${overrides.id}@example.test`,
  role: "reader",
  locale: "ru",
  nameCheckStatus: "ok",
  avatarCheckStatus: "ok",
  isServiceAccount: false,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  archivedAt: null,
  archiveMode: null,
  archivedByActorId: null,
  archivedByRole: null,
  archiveReason: null,
  archiveReasonCategory: null,
  archivePublicMessage: null,
  planTier: "free",
  planUntil: null,
  ...overrides
})

export const memoryArticle = (overrides: Partial<MemoryArticle> & { id: string; authorId: string }): MemoryArticle => ({
  slug: overrides.id,
  title: `Материал ${overrides.id}`,
  status: "published",
  sourceLocale: "ru",
  createdAt: new Date("2026-09-05T00:00:00.000Z"),
  publishedAt: new Date("2026-09-06T00:00:00.000Z"),
  archivedAt: null,
  archivedByActorId: null,
  archivedByRole: null,
  archiveReason: null,
  ...overrides
})

export const memorySession = (overrides: Partial<MemorySession> & { id: string; userId: string }): MemorySession => ({
  createdAt: new Date("2026-09-10T00:00:00.000Z"),
  lastUsedAt: new Date("2026-09-19T00:00:00.000Z"),
  expiresAt: new Date("2026-10-19T00:00:00.000Z"),
  revokedAt: null,
  userAgent: "Mozilla/5.0 (Macintosh) Chrome/140.0 Safari/537.36",
  ...overrides
})

type Where = Record<string, any>

const RELATIONS = ["sessions", "articles", "planGrants"] as const

export class MemoryPrisma {
  users: MemoryUser[]
  articles: MemoryArticle[]
  sessions: MemorySession[]
  grants: MemoryGrant[]
  consents: MemoryConsent[]
  audits: Array<Record<string, any>> = []
  emailChangeDeletes: string[] = []
  private auditSequence = 0

  constructor(seed: {
    users: MemoryUser[]
    articles?: MemoryArticle[]
    sessions?: MemorySession[]
    grants?: MemoryGrant[]
    consents?: MemoryConsent[]
  }) {
    this.users = seed.users.map((record) => ({ ...record }))
    this.articles = (seed.articles ?? []).map((record) => ({ ...record }))
    this.sessions = (seed.sessions ?? []).map((record) => ({ ...record }))
    this.grants = (seed.grants ?? []).map((record) => ({ ...record }))
    this.consents = (seed.consents ?? []).map((record) => ({ ...record }))
  }

  private relationRows(name: (typeof RELATIONS)[number], userId: string): Array<Record<string, any>> {
    if (name === "sessions") return this.sessions.filter((row) => row.userId === userId)
    if (name === "articles") return this.articles.filter((row) => row.authorId === userId)
    return this.grants.filter((row) => row.userId === userId)
  }

  private valueMatches(actual: unknown, condition: unknown): boolean {
    if (condition === null) return actual === null
    if (condition instanceof Date) return actual instanceof Date && actual.getTime() === condition.getTime()
    if (typeof condition !== "object") return actual === condition

    const rules = condition as Record<string, any>
    if ("in" in rules && !(rules.in as unknown[]).includes(actual)) return false
    if ("not" in rules) {
      if (rules.not === null && actual === null) return false
      if (rules.not !== null && actual === rules.not) return false
    }
    if (
      "contains" in rules &&
      !String(actual ?? "")
        .toLowerCase()
        .includes(String(rules.contains).toLowerCase())
    ) {
      return false
    }
    if ("gte" in rules && !(actual instanceof Date && actual >= rules.gte)) return false
    if ("gt" in rules && !(actual instanceof Date && actual > rules.gt)) return false
    if ("lte" in rules && !(actual instanceof Date && actual <= rules.lte)) return false
    return true
  }

  /** Условия раздела: `AND`/`OR`, скалярные фильтры и `some`/`none` по связям аккаунта. */
  matches(record: Record<string, any>, where: Where = {}, userId?: string): boolean {
    for (const [key, condition] of Object.entries(where)) {
      if (key === "AND") {
        if (!(condition as Where[]).every((branch) => this.matches(record, branch, userId))) return false
        continue
      }
      if (key === "OR") {
        if (!(condition as Where[]).some((branch) => this.matches(record, branch, userId))) return false
        continue
      }
      if ((RELATIONS as readonly string[]).includes(key)) {
        const rows = this.relationRows(key as (typeof RELATIONS)[number], String(record.id ?? userId))
        const filter = condition as { some?: Where; none?: Where }
        if (filter.some && !rows.some((row) => this.matches(row, filter.some))) return false
        if (filter.none && rows.some((row) => this.matches(row, filter.none))) return false
        continue
      }
      if (!this.valueMatches(record[key], condition)) return false
    }
    return true
  }

  private sort<T extends Record<string, any>>(records: T[], orderBy: unknown): T[] {
    const rules = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Array<Record<string, any>>
    return [...records].sort((left, right) => {
      for (const rule of rules) {
        const [field, direction] = Object.entries(rule)[0]!
        if (field === "articles") {
          const a = this.articles.filter((row) => row.authorId === left.id).length
          const b = this.articles.filter((row) => row.authorId === right.id).length
          if (a !== b) return direction._count === "desc" ? b - a : a - b
          continue
        }
        const a = left[field]
        const b = right[field]
        const compared =
          a instanceof Date && b instanceof Date
            ? a.getTime() - b.getTime()
            : a === b
              ? 0
              : String(a) < String(b)
                ? -1
                : 1
        // Равные значения передают решение следующему правилу, как это делает настоящий `orderBy`.
        if (compared === 0) continue
        return direction === "desc" ? -compared : compared
      }
      return 0
    })
  }

  user = {
    findUnique: async ({ where }: { where: Where }) =>
      this.users.find((candidate) => this.matches(candidate, where)) ?? null,
    findMany: async ({
      where,
      orderBy,
      skip,
      take
    }: {
      where?: Where
      orderBy?: unknown
      skip?: number
      take?: number
    }) => {
      const filtered = this.sort(
        this.users.filter((candidate) => this.matches(candidate, where ?? {})),
        orderBy
      )
      const from = skip ?? 0
      return take === undefined ? filtered.slice(from) : filtered.slice(from, from + take)
    },
    count: async ({ where }: { where?: Where }) =>
      this.users.filter((candidate) => this.matches(candidate, where ?? {})).length,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
      const record = this.users.find((candidate) => candidate.id === where.id)!
      Object.assign(record, data)
      return record
    },
    updateMany: async ({ where, data }: { where: Where; data: Record<string, any> }) => {
      const targets = this.users.filter((candidate) => this.matches(candidate, where))
      targets.forEach((target) => Object.assign(target, data))
      return { count: targets.length }
    }
  }

  article = {
    findMany: async ({ where, orderBy }: { where?: Where; orderBy?: unknown }) =>
      this.sort(
        this.articles.filter((candidate) => this.matches(candidate, where ?? {})),
        orderBy
      ),
    updateMany: async ({ where, data }: { where: Where; data: Record<string, any> }) => {
      const targets = this.articles.filter((candidate) => this.matches(candidate, where))
      targets.forEach((target) => Object.assign(target, data))
      return { count: targets.length }
    },
    count: async ({ where }: { where?: Where }) =>
      this.articles.filter((candidate) => this.matches(candidate, where ?? {})).length,
    groupBy: async ({ where }: { where?: Where }) => {
      const rows = this.articles.filter((candidate) => this.matches(candidate, where ?? {}))
      const buckets = new Map<string, { authorId: string; status: string; _count: { _all: number } }>()
      for (const row of rows) {
        const key = `${row.authorId}:${row.status}`
        const bucket = buckets.get(key) ?? { authorId: row.authorId, status: row.status, _count: { _all: 0 } }
        bucket._count._all += 1
        buckets.set(key, bucket)
      }
      return [...buckets.values()]
    }
  }

  session = {
    findMany: async ({ where, orderBy }: { where?: Where; orderBy?: unknown }) =>
      this.sort(
        this.sessions.filter((candidate) => this.matches(candidate, where ?? {})),
        orderBy
      ),
    updateMany: async ({ where, data }: { where: Where; data: Record<string, any> }) => {
      const targets = this.sessions.filter((candidate) => this.matches(candidate, where))
      targets.forEach((target) => Object.assign(target, data))
      return { count: targets.length }
    },
    groupBy: async ({ where }: { where?: Where }) => {
      const rows = this.sessions.filter((candidate) => this.matches(candidate, where ?? {}))
      const buckets = new Map<string, { userId: string; _max: { lastUsedAt: Date | null } }>()
      for (const row of rows) {
        const bucket = buckets.get(row.userId) ?? { userId: row.userId, _max: { lastUsedAt: null } }
        if (!bucket._max.lastUsedAt || row.lastUsedAt > bucket._max.lastUsedAt) bucket._max.lastUsedAt = row.lastUsedAt
        buckets.set(row.userId, bucket)
      }
      return [...buckets.values()]
    }
  }

  planGrant = {
    findMany: async ({ where }: { where?: Where }) =>
      this.grants.filter((candidate) => this.matches(candidate, where ?? {}))
  }

  userLegalConsent = {
    findMany: async ({ where, orderBy }: { where?: Where; orderBy?: unknown }) =>
      this.sort(
        this.consents.filter((candidate) => this.matches(candidate, where ?? {})),
        orderBy
      )
  }

  emailChangeRequest = {
    deleteMany: async ({ where }: { where: { userId: string } }) => {
      this.emailChangeDeletes.push(where.userId)
      return { count: 0 }
    }
  }

  auditLog = {
    create: async ({ data }: { data: Record<string, any> }) => {
      this.auditSequence += 1
      const record = { id: `audit-${this.auditSequence}`, createdAt: new Date(this.auditSequence), ...data }
      this.audits.push(record)
      return record
    },
    createMany: async ({ data }: { data: Array<Record<string, any>> }) => {
      for (const entry of data) await this.auditLog.create({ data: entry })
      return { count: data.length }
    },
    findMany: async ({ where }: { where?: Where }) =>
      this.audits.filter((candidate) => this.matches(candidate, where ?? {}))
  }

  async $transaction<T>(run: (tx: MemoryPrisma) => Promise<T>): Promise<T> {
    return run(this)
  }
}

export const adminUsersContext = (prisma: MemoryPrisma, actor: MemoryUser | null): GraphQLContext =>
  ({
    currentUser: actor ? { ...actor, permissionExceptions: [] } : null,
    requestId: "req-admin-users",
    prisma,
    cache: { delByTags: vi.fn().mockResolvedValue(undefined) },
    piiHasher: { email: (value: string) => `hash:${value}`, ip: (value: string) => `hash:${value}` },
    logger: { log: vi.fn() }
  }) as unknown as GraphQLContext

/** Записи аудита одного кода: тесты читают их без приведения на месте. */
export const auditsOf = (prisma: MemoryPrisma, action: string): Array<Record<string, any>> =>
  prisma.audits.filter((record) => record.action === action)
