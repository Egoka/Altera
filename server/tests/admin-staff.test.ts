import { GraphQLError } from "graphql"
import { describe, expect, it, vi } from "vitest"
import type { GraphQLContext } from "../src/prisma"
import {
  archiveStaffAccount,
  assignOwner,
  changeStaffRole,
  createStaff,
  deactivateOwner,
  getAdminStaffMember,
  listAdminStaff,
  listOwners,
  maskEmail,
  restoreStaffAccount,
  revokeOwner,
  revokeStaffRole
} from "../src/admin/staff"

const now = new Date("2026-09-20T12:00:00.000Z")

type Role = "reader" | "author" | "editor" | "moderator" | "analyst" | "admin" | "owner"

interface MemoryUser {
  id: string
  name: string
  email: string
  handle: string
  role: Role
  locale: string
  isServiceAccount: boolean
  archivedAt: Date | null
  archiveMode: string | null
  archivedByActorId: string | null
  archivedByRole: Role | null
  archiveReason: string | null
  createdAt: Date
}

interface MemoryException {
  id: string
  userId: string
  role: Role
  permission: string
  kind: "grant" | "deny"
  grantedById: string
  reason: string
  startsAt: Date
  endsAt: Date | null
  revokedAt: Date | null
  revokedById: string | null
  expiredAt: Date | null
}

interface MemorySession {
  id: string
  userId: string
  lastUsedAt: Date
  revokedAt: Date | null
}

function user(overrides: Partial<MemoryUser> & { id: string }): MemoryUser {
  return {
    name: `Служебная ${overrides.id}`,
    email: `${overrides.id}@altera.test`,
    handle: overrides.id,
    role: "editor",
    locale: "ru",
    isServiceAccount: true,
    archivedAt: null,
    archiveMode: null,
    archivedByActorId: null,
    archivedByRole: null,
    archiveReason: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides
  }
}

function contains(value: string, needle: string) {
  return value.toLowerCase().includes(needle.toLowerCase())
}

function matches(record: MemoryUser, where: Record<string, any> = {}): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (key === "OR") {
      const branches = condition as Array<Record<string, any>>
      if (!branches.some((branch) => matches(record, branch))) return false
      continue
    }
    const actual = (record as Record<string, unknown>)[key]
    if (condition === null) {
      if (actual !== null) return false
    } else if (typeof condition === "object" && condition !== null && !(condition instanceof Date)) {
      if ("in" in condition && !(condition.in as unknown[]).includes(actual)) return false
      if ("not" in condition && condition.not === null && actual === null) return false
      if ("contains" in condition && !contains(String(actual), condition.contains as string)) return false
    } else if (actual !== condition) {
      return false
    }
  }
  return true
}

function sortRecords<T extends Record<string, any>>(records: T[], orderBy: unknown): T[] {
  const rules = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Array<Record<string, "asc" | "desc">>
  return [...records].sort((left, right) => {
    for (const rule of rules) {
      const [field, direction] = Object.entries(rule)[0]!
      const a = left[field]
      const b = right[field]
      if (a === b) continue
      const compared =
        a instanceof Date && b instanceof Date ? a.getTime() - b.getTime() : String(a) < String(b) ? -1 : 1
      return direction === "desc" ? -compared : compared
    }
    return 0
  })
}

class MemoryPrisma {
  users: MemoryUser[] = []
  exceptions: MemoryException[] = []
  sessions: MemorySession[] = []
  audits: Array<Record<string, any>> = []
  handles: Array<{ handle: string; userId: string | null }> = []
  magicLinks: Array<{ userId: string }> = []
  private auditSequence = 0

  constructor(users: MemoryUser[], options: { exceptions?: MemoryException[]; sessions?: MemorySession[] } = {}) {
    // Копии: общие фикстуры не переносят изменения одного теста в другой.
    this.users = users.map((record) => ({ ...record }))
    this.exceptions = options.exceptions ?? []
    this.sessions = options.sessions ?? []
  }

  private decorate(record: MemoryUser) {
    return {
      ...record,
      permissionExceptions: this.exceptions.filter(({ userId }) => userId === record.id),
      sessions: sortRecords(
        this.sessions.filter(({ userId }) => userId === record.id),
        { lastUsedAt: "desc" }
      ).slice(0, 1)
    }
  }

  user = {
    findUnique: async ({ where }: { where: Record<string, any> }) => {
      const record = this.users.find((candidate) => matches(candidate, where))
      return record ? this.decorate(record) : null
    },
    findMany: async ({ where, orderBy }: { where?: Record<string, any>; orderBy?: unknown }) =>
      sortRecords(
        this.users.filter((candidate) => matches(candidate, where ?? {})),
        orderBy
      ).map((record) => this.decorate(record)),
    count: async ({ where }: { where: Record<string, any> }) =>
      this.users.filter((candidate) => matches(candidate, where)).length,
    create: async ({ data }: { data: Record<string, any> }) => {
      const record = user({ id: data.id ?? `user-${this.users.length + 1}`, ...data, role: data.role ?? "reader" })
      record.isServiceAccount = data.isServiceAccount ?? false
      this.users.push(record)
      return this.decorate(record)
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
      const record = this.users.find((candidate) => candidate.id === where.id)!
      Object.assign(record, data)
      return this.decorate(record)
    },
    updateMany: async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
      const targets = this.users.filter((candidate) => matches(candidate, where))
      targets.forEach((target) => Object.assign(target, data))
      return { count: targets.length }
    }
  }

  session = {
    count: async ({ where }: { where: Record<string, any> }) =>
      this.sessions.filter((candidate) => matches(candidate as never, where)).length,
    updateMany: async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
      const targets = this.sessions.filter((candidate) => matches(candidate as never, where))
      targets.forEach((target) => Object.assign(target, data))
      return { count: targets.length }
    }
  }

  auditLog = {
    create: async ({ data }: { data: Record<string, any> }) => {
      this.auditSequence += 1
      const record = {
        id: `audit-${this.auditSequence}`,
        createdAt: new Date(now.getTime() + this.auditSequence),
        ...data
      }
      this.audits.push(record)
      return record
    },
    findMany: async ({ where, orderBy }: { where: Record<string, any>; orderBy?: unknown }) =>
      sortRecords(
        this.audits.filter((candidate) => matches(candidate as never, where)),
        orderBy
      )
  }

  handleHistory = {
    create: async ({ data }: { data: { handle: string; userId?: string | null } }) => {
      this.handles.push({ handle: data.handle, userId: data.userId ?? null })
      return data
    },
    update: async ({ where, data }: { where: { handle: string }; data: { userId: string } }) => {
      const record = this.handles.find((candidate) => candidate.handle === where.handle)!
      record.userId = data.userId
      return record
    }
  }

  magicLinkToken = {
    upsert: async ({ where }: { where: { userId: string } }) => {
      this.magicLinks.push({ userId: where.userId })
      return where
    }
  }

  async $transaction<T>(run: (tx: MemoryPrisma) => Promise<T>): Promise<T> {
    return run(this)
  }
}

function context(prisma: MemoryPrisma, actor: MemoryUser | null, mailSend = vi.fn().mockResolvedValue({})) {
  return {
    currentUser: actor ? { ...actor, planTier: "free", planUntil: null, permissionExceptions: [] } : null,
    requestId: "req-staff",
    prisma,
    mail: { send: mailSend },
    piiHasher: { email: () => "email-digest", ip: () => "ip-digest" },
    logger: { log: vi.fn() }
  } as unknown as GraphQLContext
}

const ownerActor = user({ id: "owner-1", role: "owner", name: "Первый владелец" })
const secondOwner = user({ id: "owner-2", role: "owner", name: "Второй владелец" })
const adminActor = user({ id: "admin-1", role: "admin", name: "Администратор" })

function extensionsOf(error: unknown): Record<string, unknown> {
  return (error as GraphQLError).extensions as Record<string, unknown>
}

async function capture(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await run()
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(GraphQLError)
    return extensionsOf(error)
  }
  throw new Error("Expected the call to reject")
}

describe("служебные записи: создание", () => {
  it("создаёт запись с ролью, письмом входа и аудитом user.create.staff", async () => {
    const prisma = new MemoryPrisma([adminActor])
    const mailSend = vi.fn().mockResolvedValue({ mailId: "mail-1", messageId: null })
    const ctx = context(prisma, adminActor, mailSend)

    const created = await createStaff(ctx, { email: "Editor@Altera.test", role: "editor", name: "Редактор" }, now)

    expect(created.role).toBe("editor")
    expect(created.status).toBe("active")
    expect(prisma.users.find(({ email }) => email === "editor@altera.test")?.isServiceAccount).toBe(true)
    expect(mailSend).toHaveBeenCalledTimes(1)
    const audit = prisma.audits.find(({ action }) => action === "user.create.staff")
    expect(audit?.diff).toMatchObject({ role: "editor", emailHash: "email-digest" })
    expect(JSON.stringify(audit)).not.toContain("editor@altera.test")
  })

  it("отказывает в повышении существующего читателя или автора", async () => {
    const reader = user({ id: "reader-1", role: "author", isServiceAccount: false, email: "author@altera.test" })
    const prisma = new MemoryPrisma([adminActor, reader])
    const ctx = context(prisma, adminActor)

    const extensions = await capture(() =>
      createStaff(ctx, { email: "author@altera.test", role: "editor", name: "Редактор" }, now)
    )

    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field: "email", rule: "not-an-account" })
  })

  it("отказывает, когда e-mail уже занят служебной записью", async () => {
    const prisma = new MemoryPrisma([adminActor, user({ id: "editor-1", email: "editor@altera.test" })])
    const ctx = context(prisma, adminActor)

    const extensions = await capture(() =>
      createStaff(ctx, { email: "editor@altera.test", role: "editor", name: "Редактор" }, now)
    )

    expect(extensions).toMatchObject({ code: "CONFLICT", entity: "user" })
  })

  it("не даёт создать владельца записью — роль owner выдаётся вторым шагом", async () => {
    const prisma = new MemoryPrisma([ownerActor])
    const ctx = context(prisma, ownerActor)

    const extensions = await capture(() =>
      createStaff(ctx, { email: "new-owner@altera.test", role: "owner" as never, name: "Владелец" }, now)
    )

    expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "staff.create.owner" })
    expect(prisma.users.some(({ email }) => email === "new-owner@altera.test")).toBe(false)
  })

  it("не отменяет созданную запись, когда почта недоступна", async () => {
    const prisma = new MemoryPrisma([adminActor])
    const mailSend = vi.fn().mockRejectedValue(new Error("smtp down"))
    const ctx = context(prisma, adminActor, mailSend)

    await expect(
      createStaff(ctx, { email: "editor@altera.test", role: "editor", name: "Редактор" }, now)
    ).rejects.toThrow("smtp down")
    expect(prisma.users.some(({ email }) => email === "editor@altera.test")).toBe(true)
  })

  it("читателя не пускает к созданию служебных записей", async () => {
    const reader = user({ id: "reader-2", role: "reader", isServiceAccount: false })
    const prisma = new MemoryPrisma([reader])
    const ctx = context(prisma, reader)

    const extensions = await capture(() =>
      createStaff(ctx, { email: "editor@altera.test", role: "editor", name: "Редактор" }, now)
    )

    expect(extensions).toMatchObject({ code: "FORBIDDEN" })
  })
})

// AC-2: назначение владельца завершается только вторым шагом.
describe("назначение владельца в два шага", () => {
  it("после первого шага владельцев не прибавляется, второй шаг выдаёт роль", async () => {
    const prisma = new MemoryPrisma([ownerActor])
    const ctx = context(prisma, ownerActor)

    const created = await createStaff(ctx, { email: "next@altera.test", role: "admin", name: "Кандидат" }, now)

    expect(created.role).toBe("admin")
    expect(prisma.users.filter(({ role }) => role === "owner")).toHaveLength(1)
    expect(prisma.audits.some(({ action }) => action === "role.assign.owner")).toBe(false)

    const promoted = await assignOwner(ctx, { id: created.id }, now)

    expect(promoted.role).toBe("owner")
    expect(prisma.users.filter(({ role }) => role === "owner")).toHaveLength(2)
    expect(prisma.audits.find(({ action }) => action === "role.assign.owner")?.diff).toMatchObject({
      before: "admin",
      after: "owner",
      remainingOwners: 2
    })
  })

  it("не назначает владельцем обычный аккаунт", async () => {
    const author = user({ id: "author-1", role: "author", isServiceAccount: false })
    const prisma = new MemoryPrisma([ownerActor, author])
    const ctx = context(prisma, ownerActor)

    const extensions = await capture(() => assignOwner(ctx, { id: author.id }, now))

    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field: "id", rule: "service-account" })
  })

  it("не назначает владельцем архивированную запись", async () => {
    const archived = user({ id: "editor-archived", archivedAt: new Date("2026-09-10T00:00:00.000Z") })
    const prisma = new MemoryPrisma([ownerActor, archived])
    const ctx = context(prisma, ownerActor)

    const extensions = await capture(() => assignOwner(ctx, { id: archived.id }, now))

    expect(extensions).toMatchObject({ code: "ARCHIVED", entity: "user" })
  })

  it("не даёт администратору назначить владельца", async () => {
    const candidate = user({ id: "editor-2" })
    const prisma = new MemoryPrisma([adminActor, candidate])
    const ctx = context(prisma, adminActor)

    const extensions = await capture(() => assignOwner(ctx, { id: candidate.id }, now))

    expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "owner.assign" })
  })
})

// AC-1: попытка оставить ноль владельцев — CONFLICT.
describe("инвариант «не ноль владельцев»", () => {
  // Снимок сессии актора ещё содержит роль owner, хотя другой владелец уже её снял:
  // без проверки в транзакции отзыв оставил бы систему без владельцев.
  it("отклоняет отзыв, который оставил бы ноль владельцев, и не меняет запись", async () => {
    const prisma = new MemoryPrisma([{ ...ownerActor, role: "admin" }, secondOwner])
    const ctx = context(prisma, ownerActor)

    const extensions = await capture(() => revokeOwner(ctx, { id: secondOwner.id, reason: "Уходит" }, now))

    expect(extensions).toMatchObject({ code: "CONFLICT", entity: "owner", expected: "at-least-one", actual: 0 })
    expect(prisma.audits.some(({ action }) => action === "role.revoke.owner")).toBe(false)
  })

  it("отклоняет деактивацию, которая оставила бы ноль владельцев", async () => {
    const prisma = new MemoryPrisma([{ ...ownerActor, role: "admin" }, secondOwner])
    const ctx = context(prisma, ownerActor)

    const extensions = await capture(() => deactivateOwner(ctx, { id: secondOwner.id, reason: "Отпуск" }, now))

    expect(extensions).toMatchObject({ code: "CONFLICT", entity: "owner", expected: "at-least-one", actual: 0 })
    expect(prisma.audits.some(({ action }) => action === "owner.deactivate")).toBe(false)
  })

  it("разрешает отзыв, когда остаётся второй владелец", async () => {
    const prisma = new MemoryPrisma([ownerActor, secondOwner])
    const ctx = context(prisma, ownerActor)

    const revoked = await revokeOwner(ctx, { id: secondOwner.id, reason: "Передал дела" }, now)

    expect(revoked.role).toBe("reader")
    expect(prisma.audits.find(({ action }) => action === "role.revoke.owner")?.diff).toMatchObject({
      before: "owner",
      after: "reader",
      remainingOwners: 1
    })
  })

  it("разрешает деактивацию, когда остаётся второй владелец, и отзывает сессии", async () => {
    const prisma = new MemoryPrisma([ownerActor, secondOwner], {
      sessions: [{ id: "session-1", userId: secondOwner.id, lastUsedAt: now, revokedAt: null }]
    })
    const ctx = context(prisma, ownerActor)

    const deactivated = await deactivateOwner(ctx, { id: secondOwner.id, reason: "Передал дела" }, now)

    expect(deactivated.status).toBe("archived")
    expect(prisma.sessions[0]?.revokedAt).toEqual(now)
    expect(prisma.audits.find(({ action }) => action === "owner.deactivate")?.diff).toMatchObject({
      remainingOwners: 1
    })
  })

  it("не даёт владельцу снять роль с себя", async () => {
    const prisma = new MemoryPrisma([ownerActor, secondOwner])
    const ctx = context(prisma, ownerActor)

    const extensions = await capture(() => revokeOwner(ctx, { id: ownerActor.id, reason: "Сам" }, now))

    expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "owner.revoke" })
  })
})

describe("смена и снятие служебной роли", () => {
  it("меняет роль по требованию владельца и пишет до/после в аудит", async () => {
    const editor = user({ id: "editor-3", role: "editor" })
    const prisma = new MemoryPrisma([ownerActor, editor])
    const ctx = context(prisma, ownerActor)

    const changed = await changeStaffRole(ctx, { id: editor.id, role: "moderator", reason: "Перевод" }, now)

    expect(changed.role).toBe("moderator")
    expect(prisma.audits.find(({ action }) => action === "user.role.change")?.diff).toMatchObject({
      targetId: editor.id,
      before: "editor",
      after: "moderator",
      reason: "Перевод"
    })
  })

  it("не даёт администратору менять роли", async () => {
    const editor = user({ id: "editor-4" })
    const prisma = new MemoryPrisma([adminActor, editor])
    const ctx = context(prisma, adminActor)

    const extensions = await capture(() =>
      changeStaffRole(ctx, { id: editor.id, role: "moderator", reason: "Перевод" }, now)
    )

    expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "staff.role.change" })
    expect(prisma.users.find(({ id }) => id === editor.id)?.role).toBe("editor")
  })

  it("требует причину", async () => {
    const editor = user({ id: "editor-5" })
    const prisma = new MemoryPrisma([ownerActor, editor])
    const ctx = context(prisma, ownerActor)

    const extensions = await capture(() => changeStaffRole(ctx, { id: editor.id, role: "analyst", reason: "  " }, now))

    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field: "reason", rule: "required" })
  })

  it("сообщает о конфликте, когда роль уже изменена другим владельцем", async () => {
    const editor = user({ id: "editor-6", role: "editor" })
    const prisma = new MemoryPrisma([ownerActor, editor])
    const ctx = context(prisma, ownerActor)
    const original = prisma.user.findUnique
    prisma.user.findUnique = async (args) => {
      const record = await original.call(prisma, args)
      // Другой владелец успевает сменить роль между чтением и записью.
      const target = prisma.users.find(({ id }) => id === editor.id)
      if (target && target.role === "editor") target.role = "analyst"
      return record
    }

    const extensions = await capture(() =>
      changeStaffRole(ctx, { id: editor.id, role: "moderator", reason: "Перевод" }, now)
    )

    expect(extensions).toMatchObject({ code: "CONFLICT", entity: "user", expected: "editor", actual: "changed" })
  })

  it("снимает роль и оставляет запись служебной без прав", async () => {
    const editor = user({ id: "editor-7", role: "editor" })
    const prisma = new MemoryPrisma([ownerActor, editor], {
      exceptions: [
        {
          id: "exception-1",
          userId: editor.id,
          role: "editor",
          permission: "publish",
          kind: "grant",
          grantedById: ownerActor.id,
          reason: "Совмещение",
          startsAt: new Date("2026-09-02T00:00:00.000Z"),
          endsAt: null,
          revokedAt: null,
          revokedById: null,
          expiredAt: null
        }
      ]
    })
    const ctx = context(prisma, ownerActor)

    const revoked = await revokeStaffRole(ctx, { id: editor.id, reason: "Ушёл" }, now)

    expect(revoked.role).toBe("reader")
    expect(prisma.users.find(({ id }) => id === editor.id)?.isServiceAccount).toBe(true)
    // Исключение выдано для роли editor и после снятия роли не действует.
    expect(revoked.activeExceptionCount).toBe(0)
  })

  it("не меняет роль владельца обычной сменой роли", async () => {
    const prisma = new MemoryPrisma([ownerActor, secondOwner])
    const ctx = context(prisma, ownerActor)

    const extensions = await capture(() =>
      changeStaffRole(ctx, { id: secondOwner.id, role: "admin", reason: "Понижение" }, now)
    )

    expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "staff.role.change.owner" })
  })
})

describe("архив служебной записи", () => {
  it("архивирует по требованию владельца, отзывает сессии и пишет user.archive", async () => {
    const editor = user({ id: "editor-8" })
    const prisma = new MemoryPrisma([ownerActor, editor], {
      sessions: [{ id: "session-2", userId: editor.id, lastUsedAt: now, revokedAt: null }]
    })
    const ctx = context(prisma, ownerActor)

    const archived = await archiveStaffAccount(ctx, { id: editor.id, reason: "Уволен" }, now)

    expect(archived.status).toBe("archived")
    expect(archived.archiveReason).toBe("Уволен")
    expect(prisma.sessions[0]?.revokedAt).toEqual(now)
    expect(prisma.audits.some(({ action }) => action === "user.archive")).toBe(true)
  })

  it("не даёт администратору архивировать чужую служебную запись", async () => {
    const editor = user({ id: "editor-9" })
    const prisma = new MemoryPrisma([adminActor, editor])
    const ctx = context(prisma, adminActor)

    const extensions = await capture(() => archiveStaffAccount(ctx, { id: editor.id, reason: "Уволен" }, now))

    expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "staff.archive" })
    expect(prisma.users.find(({ id }) => id === editor.id)?.archivedAt).toBeNull()
  })

  it("не даёт администратору восстановить служебную запись", async () => {
    const editor = user({ id: "editor-10", archivedAt: new Date("2026-09-05T00:00:00.000Z") })
    const prisma = new MemoryPrisma([adminActor, editor])
    const ctx = context(prisma, adminActor)

    const extensions = await capture(() => restoreStaffAccount(ctx, { id: editor.id, reason: "Вернулся" }, now))

    expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "staff.restore" })
  })

  it("восстанавливает запись владельцем и возвращает прежнюю роль", async () => {
    const editor = user({ id: "editor-11", role: "moderator", archivedAt: new Date("2026-09-05T00:00:00.000Z") })
    const prisma = new MemoryPrisma([ownerActor, editor])
    const ctx = context(prisma, ownerActor)

    const restored = await restoreStaffAccount(ctx, { id: editor.id, reason: "Вернулся" }, now)

    expect(restored.status).toBe("active")
    expect(restored.role).toBe("moderator")
    expect(prisma.audits.some(({ action }) => action === "user.restore")).toBe(true)
  })

  it("направляет владельца к отдельной деактивации вместо архива", async () => {
    const prisma = new MemoryPrisma([ownerActor, secondOwner])
    const ctx = context(prisma, ownerActor)

    const extensions = await capture(() => archiveStaffAccount(ctx, { id: secondOwner.id, reason: "Уходит" }, now))

    expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "staff.archive.owner" })
  })
})

describe("список и карточка", () => {
  it("маскирует e-mail в списке и показывает полный в карточке с аудитом чтения", async () => {
    const editor = user({ id: "editor-12", email: "editor@altera.test" })
    const prisma = new MemoryPrisma([adminActor, editor])
    const ctx = context(prisma, adminActor)

    const listed = (await listAdminStaff(ctx, {}, now)).find(({ id }) => id === editor.id)
    expect(listed?.email).toBe("e***r@altera.test")
    expect(listed?.emailMasked).toBe(true)

    const card = await getAdminStaffMember(ctx, editor.id, now)
    expect(card?.email).toBe("editor@altera.test")
    expect(card?.emailMasked).toBe(false)
    expect(prisma.audits.some(({ action }) => action === "admin.read.personal")).toBe(true)
  })

  it("возвращает по умолчанию только активные записи и отдаёт архив по фильтру", async () => {
    const active = user({ id: "editor-13" })
    const archived = user({ id: "editor-14", archivedAt: new Date("2026-09-05T00:00:00.000Z") })
    const prisma = new MemoryPrisma([adminActor, active, archived])
    const ctx = context(prisma, adminActor)

    const activeRows = await listAdminStaff(ctx, {}, now)
    expect(activeRows.map(({ id }) => id)).toEqual([adminActor.id, active.id])

    const archivedRows = await listAdminStaff(ctx, { status: "archived" }, now)
    expect(archivedRows.map(({ id }) => id)).toEqual([archived.id])
  })

  it("фильтрует по действующим исключениям и их сроку", async () => {
    const withIndefinite = user({ id: "editor-15" })
    const withExpiring = user({ id: "editor-16" })
    const withoutExceptions = user({ id: "editor-17" })
    const prisma = new MemoryPrisma([ownerActor, withIndefinite, withExpiring, withoutExceptions], {
      exceptions: [
        {
          id: "exception-2",
          userId: withIndefinite.id,
          role: "editor",
          permission: "publish",
          kind: "grant",
          grantedById: ownerActor.id,
          reason: "Бессрочное",
          startsAt: new Date("2026-09-02T00:00:00.000Z"),
          endsAt: null,
          revokedAt: null,
          revokedById: null,
          expiredAt: null
        },
        {
          id: "exception-3",
          userId: withExpiring.id,
          role: "editor",
          permission: "review",
          kind: "grant",
          grantedById: ownerActor.id,
          reason: "Срочное",
          startsAt: new Date("2026-09-02T00:00:00.000Z"),
          endsAt: new Date("2026-09-30T00:00:00.000Z"),
          revokedAt: null,
          revokedById: null,
          expiredAt: null
        }
      ]
    })
    const ctx = context(prisma, ownerActor)

    expect((await listAdminStaff(ctx, { hasExceptions: true }, now)).map(({ id }) => id)).toEqual([
      withIndefinite.id,
      withExpiring.id
    ])
    expect((await listAdminStaff(ctx, { term: "indefinite" }, now)).map(({ id }) => id)).toEqual([withIndefinite.id])
    expect((await listAdminStaff(ctx, { term: "expiring" }, now)).map(({ id }) => id)).toEqual([withExpiring.id])
  })

  it("ищет по имени и адресу от трёх знаков", async () => {
    const editor = user({ id: "editor-18", name: "Мария", email: "maria@altera.test" })
    const other = user({ id: "editor-19", name: "Пётр", email: "petr@altera.test" })
    const prisma = new MemoryPrisma([ownerActor, editor, other])
    const ctx = context(prisma, ownerActor)

    expect((await listAdminStaff(ctx, { search: "мар" }, now)).map(({ id }) => id)).toEqual([editor.id])
    expect((await listAdminStaff(ctx, { search: "ма" }, now)).map(({ id }) => id)).toHaveLength(3)
  })

  it("не показывает служебный раздел обычному аккаунту", async () => {
    const author = user({ id: "author-2", role: "author", isServiceAccount: false })
    const prisma = new MemoryPrisma([author])
    const ctx = context(prisma, author)

    const extensions = await capture(() => listAdminStaff(ctx, {}, now))

    expect(extensions).toMatchObject({ code: "FORBIDDEN", action: "staff.read" })
  })

  it("отдаёт список владельцев с датой назначения только владельцу", async () => {
    const prisma = new MemoryPrisma([ownerActor, user({ id: "editor-20" })])
    const ctx = context(prisma, ownerActor)
    const promoted = await assignOwner(ctx, { id: "editor-20" }, now)

    const owners = await listOwners(ctx)

    expect(owners.map(({ id }) => id).sort()).toEqual([ownerActor.id, promoted.id].sort())
    expect(owners.find(({ id }) => id === promoted.id)?.assignedAt).toBeInstanceOf(Date)

    const adminCtx = context(prisma, adminActor)
    expect(await capture(() => listOwners(adminCtx))).toMatchObject({ code: "FORBIDDEN", action: "owner.read" })
  })

  it("возвращает историю ролей в карточке", async () => {
    const editor = user({ id: "editor-21", role: "editor" })
    const prisma = new MemoryPrisma([ownerActor, editor])
    const ctx = context(prisma, ownerActor)
    await changeStaffRole(ctx, { id: editor.id, role: "moderator", reason: "Перевод" }, now)

    const card = await getAdminStaffMember(ctx, editor.id, now)

    expect(card?.roleHistory).toHaveLength(1)
    expect(card?.roleHistory[0]).toMatchObject({
      before: "editor",
      after: "moderator",
      actorName: ownerActor.name,
      reason: "Перевод"
    })
  })

  it("не выдаёт карточку обычного аккаунта через служебный раздел", async () => {
    const author = user({ id: "author-3", role: "author", isServiceAccount: false })
    const prisma = new MemoryPrisma([adminActor, author])
    const ctx = context(prisma, adminActor)

    expect(await getAdminStaffMember(ctx, author.id, now)).toBeNull()
  })
})

describe("маскирование адреса", () => {
  it("оставляет домен и скрывает локальную часть", () => {
    expect(maskEmail("editor@altera.test")).toBe("e***r@altera.test")
    expect(maskEmail("ab@altera.test")).toBe("a***@altera.test")
    expect(maskEmail("broken")).toBe("***")
  })
})
