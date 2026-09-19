import { GraphQLError } from "graphql"
import { describe, expect, it } from "vitest"
import { ensurePermission, type PermissionException } from "../src/exceptions/permissions"
import {
  expirePermissionExceptions,
  grantPermissionException,
  revokePermissionException
} from "../src/permission-exceptions/service"

const owner = { id: "owner-1", role: "owner" as const }
const admin = { id: "admin-1", role: "admin" as const }

interface StoredException extends PermissionException {
  id: string
  grantedById: string
  reason: string
  expiredAt: Date | null
  revokedById: string | null
}

class MemoryPermissionClient {
  users = new Map([
    ["editor-1", { id: "editor-1", role: "editor" as const, isServiceAccount: true }],
    ["author-1", { id: "author-1", role: "author" as const, isServiceAccount: false }]
  ])
  exceptions: StoredException[] = []
  audits: Array<Record<string, unknown>> = []

  user = {
    findUnique: async (args: { where: { id: string } }) => {
      void args
      return null as { id: string; role: "editor" | "author"; isServiceAccount: boolean } | null
    }
  }

  permissionException = {
    create: async (args: { data: Omit<StoredException, "id"> }) => {
      void args
      return null as StoredException | null
    },
    findUnique: async (args: { where: { id: string } }) => {
      void args
      return null as StoredException | null
    },
    findMany: async (args: { where: { expiredAt: null; revokedAt: null; endsAt: { lte: Date } } }) => {
      void args
      return [] as StoredException[]
    },
    updateMany: async (args: {
      where: { id: string; expiredAt?: null; revokedAt?: null }
      data: Partial<StoredException>
    }): Promise<{ count: number }> => {
      void args
      return { count: 0 }
    }
  }

  auditLog = {
    create: async (args: { data: Record<string, unknown> }): Promise<Record<string, unknown>> => {
      void args
      return {}
    }
  }

  constructor() {
    this.user.findUnique = async ({ where }: { where: { id: string } }) => this.users.get(where.id) ?? null
    this.permissionException.create = async ({ data }: { data: Omit<StoredException, "id"> }) => {
      const exception = { id: `exception-${this.exceptions.length + 1}`, ...data }
      this.exceptions.push(exception)
      return exception
    }
    this.permissionException.findUnique = async ({ where }: { where: { id: string } }) =>
      this.exceptions.find(({ id }) => id === where.id) ?? null
    this.permissionException.findMany = async ({
      where
    }: {
      where: { expiredAt: null; revokedAt: null; endsAt: { lte: Date } }
    }) =>
      this.exceptions.filter(
        ({ expiredAt, revokedAt, endsAt }) =>
          expiredAt === where.expiredAt &&
          revokedAt === where.revokedAt &&
          endsAt !== null &&
          endsAt <= where.endsAt.lte
      )
    this.permissionException.updateMany = async ({
      where,
      data
    }: {
      where: { id: string; expiredAt?: null; revokedAt?: null }
      data: Partial<StoredException>
    }) => {
      const exception = this.exceptions.find(({ id }) => id === where.id)
      if (
        !exception ||
        (where.expiredAt === null && exception.expiredAt !== null) ||
        (where.revokedAt === null && exception.revokedAt !== null)
      ) {
        return { count: 0 }
      }
      Object.assign(exception, data)
      return { count: 1 }
    }
    this.auditLog.create = async ({ data }: { data: Record<string, unknown> }) => {
      this.audits.push(data)
      return data
    }
  }

  async $transaction<T>(run: (tx: MemoryPermissionClient) => Promise<T>): Promise<T> {
    return run(this)
  }
}

describe("permission exceptions", () => {
  it("rejects a grant issued by a non-owner", async () => {
    await expect(
      grantPermissionException({} as never, {
        actor: admin,
        userId: "editor-1",
        permission: "publish",
        kind: "grant",
        reason: "temporary publication duty",
        endsAt: null,
        requestId: "req-forbidden",
        now: new Date("2026-09-18T00:00:00.000Z")
      })
    ).rejects.toMatchObject<Partial<GraphQLError>>({
      extensions: { code: "FORBIDDEN", requestId: "req-forbidden", action: "permission.exception.grant" }
    })
  })

  it("creates an owner grant and its audit record atomically", async () => {
    const client = new MemoryPermissionClient()
    const endsAt = new Date("2026-10-01T00:00:00.000Z")

    const exception = await grantPermissionException(client, {
      actor: owner,
      userId: "editor-1",
      permission: "publish",
      kind: "grant",
      reason: "temporary publication duty",
      endsAt,
      requestId: "req-grant",
      now: new Date("2026-09-18T00:00:00.000Z")
    })

    expect(exception).toMatchObject({ userId: "editor-1", role: "editor", permission: "publish", endsAt })
    expect(client.audits).toEqual([
      expect.objectContaining({
        action: "permission.exception.grant",
        actorId: "owner-1",
        entityType: "permission_exception",
        entityId: exception.id,
        requestId: "req-grant"
      })
    ])
  })

  it("rejects exceptions for a non-service role", async () => {
    const client = new MemoryPermissionClient()

    await expect(
      grantPermissionException(client, {
        actor: owner,
        userId: "author-1",
        permission: "publish",
        kind: "grant",
        reason: "not allowed",
        endsAt: null,
        requestId: "req-author",
        now: new Date("2026-09-18T00:00:00.000Z")
      })
    ).rejects.toMatchObject<Partial<GraphQLError>>({ extensions: { code: "VALIDATION_ERROR", field: "userId" } })
  })

  it("revokes an active exception and writes a revoke audit", async () => {
    const client = new MemoryPermissionClient()
    const exception = await grantPermissionException(client, {
      actor: owner,
      userId: "editor-1",
      permission: "publish",
      kind: "grant",
      reason: "temporary publication duty",
      endsAt: null,
      requestId: "req-grant",
      now: new Date("2026-09-18T00:00:00.000Z")
    })

    const revoked = await revokePermissionException(client, {
      actor: owner,
      id: exception.id,
      reason: "duty ended",
      requestId: "req-revoke",
      now: new Date("2026-09-19T00:00:00.000Z")
    })

    expect(revoked).toMatchObject({ revokedById: "owner-1", revokedAt: new Date("2026-09-19T00:00:00.000Z") })
    expect(client.audits.at(-1)).toEqual(
      expect.objectContaining({
        action: "permission.exception.revoke",
        entityId: exception.id,
        requestId: "req-revoke"
      })
    )
  })

  it("expires a right at the injected time and audits it only once", async () => {
    const client = new MemoryPermissionClient()
    const exception = await grantPermissionException(client, {
      actor: owner,
      userId: "editor-1",
      permission: "review",
      kind: "grant",
      reason: "review rotation",
      endsAt: new Date("2026-09-20T00:00:00.000Z"),
      requestId: "req-grant",
      now: new Date("2026-09-18T00:00:00.000Z")
    })
    const now = new Date("2026-09-20T00:00:00.000Z")

    await expirePermissionExceptions(client, { now, requestId: "expiry-run-1" })
    await expirePermissionExceptions(client, { now, requestId: "expiry-run-2" })

    expect(() =>
      ensurePermission(
        { id: "editor-1", role: "editor", archivedAt: null, planTier: "free", planUntil: null },
        "review",
        "article.review",
        "req-check",
        { exceptions: [exception], now }
      )
    ).toThrowError(GraphQLError)
    expect(client.audits.filter(({ action }) => action === "permission.exception.expire")).toEqual([
      expect.objectContaining({ entityId: exception.id, requestId: "expiry-run-1" })
    ])
  })
})
