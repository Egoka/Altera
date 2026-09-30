import { describe, expect, it, vi } from "vitest"
import accountExportResolver from "../src/graphql/account-export/resolver"
import type { GraphQLContext } from "../src/prisma"

function context(options: { signedIn?: boolean; archived?: boolean } = {}) {
  const accountExports = {
    list: vi.fn().mockResolvedValue([{ id: "export-1", status: "queued" }]),
    request: vi.fn().mockResolvedValue({ id: "export-2", status: "queued" }),
    download: vi.fn().mockResolvedValue("https://files.example.test/export.zip?signature=secret")
  }
  const currentUser =
    options.signedIn === false
      ? null
      : {
          id: "user-1",
          archivedAt: options.archived ? new Date("2026-09-01T00:00:00.000Z") : null
        }
  return {
    accountExports,
    ctx: {
      currentUser,
      requestId: "request-1",
      accountExports
    } as unknown as GraphQLContext
  }
}

describe("GraphQL выгрузки аккаунта", () => {
  it("поле AccountUser.exports читает только историю текущего владельца", async () => {
    const { ctx, accountExports } = context()

    await expect(accountExportResolver.AccountUser.exports({ id: "user-1" }, {}, ctx)).resolves.toEqual([
      { id: "export-1", status: "queued" }
    ])
    expect(accountExports.list).toHaveBeenCalledWith("user-1")

    await expect(accountExportResolver.AccountUser.exports({ id: "other-user" }, {}, ctx)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" }
    })
    expect(accountExports.list).toHaveBeenCalledTimes(1)
  })

  it("гость не может запросить выгрузку, а ограниченная сессия получает FORBIDDEN", async () => {
    const guest = context({ signedIn: false })
    await expect(
      accountExportResolver.Mutation.requestExport(null, { scope: ["profile"] }, guest.ctx)
    ).rejects.toMatchObject({ extensions: { code: "UNAUTHENTICATED" } })
    expect(guest.accountExports.request).not.toHaveBeenCalled()

    const archived = context({ archived: true })
    await expect(
      accountExportResolver.Mutation.requestExport(null, { scope: ["profile"] }, archived.ctx)
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } })
    expect(archived.accountExports.request).not.toHaveBeenCalled()
  })

  it("запрос и скачивание всегда привязаны к id текущего пользователя", async () => {
    const { ctx, accountExports } = context()

    await expect(
      accountExportResolver.Mutation.requestExport(null, { scope: ["profile", "media"] }, ctx)
    ).resolves.toEqual({ id: "export-2", status: "queued" })
    expect(accountExports.request).toHaveBeenCalledWith("user-1", ["profile", "media"], "request-1")

    await expect(accountExportResolver.Mutation.exportDownload(null, { id: "export-2" }, ctx)).resolves.toBe(
      "https://files.example.test/export.zip?signature=secret"
    )
    expect(accountExports.download).toHaveBeenCalledWith("user-1", "export-2", "request-1")
  })
})
