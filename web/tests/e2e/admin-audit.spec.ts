import { expect, test } from "@playwright/test"
import { createHmac } from "node:crypto"
import { PrismaClient, type Role } from "../../../server/src/generated/prisma/index.js"

/**
 * T-079: строки состояний `docs/spec/40-admin/audit-log.md` §9 под ролями, маршрутные коды §2 и
 * критерий «просмотр аудита не создаёт записей» (журнал §27.5 п. 5).
 *
 * Журнал неизменяем (триггеры запрещают UPDATE и DELETE), поэтому фикстуры только создаются, а
 * идентификаторы уникальны для прогона.
 */
const databaseUrl =
  process.env.T079_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
const accessSecret = "t009-test-access-secret"

const serviceRoles = ["editor", "moderator", "analyst", "admin", "owner"] as const satisfies readonly Role[]
type TestRole = (typeof serviceRoles)[number] | "author" | "limitAdmin"

const run = Date.now().toString(36)
const userIds: Record<TestRole, string> = {
  editor: "t079-editor",
  moderator: "t079-moderator",
  analyst: "t079-analyst",
  admin: "t079-admin",
  owner: "t079-owner",
  author: "t079-author",
  limitAdmin: "t079-limit-admin"
}
const roleOf: Record<TestRole, Role> = {
  editor: "editor",
  moderator: "moderator",
  analyst: "analyst",
  admin: "admin",
  owner: "owner",
  author: "author",
  limitAdmin: "admin"
}
const entryIds = {
  editorial: `t079-${run}-editorial`,
  moderation: `t079-${run}-moderation`,
  finance: `t079-${run}-finance`,
  personal: `t079-${run}-personal`,
  closed: `t079-${run}-closed`,
  system: `t079-${run}-system`
}
const subjectUserId = `t079-${run}-target`

const signToken = (role: TestRole) => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900, role: roleOf[role], userId: userIds[role] })
  ).toString("base64url")
  const unsigned = `${header}.${payload}`
  return `${unsigned}.${createHmac("sha256", accessSecret).update(unsigned).digest("base64url")}`
}

async function upsertUser(role: TestRole) {
  const id = userIds[role]
  const handle = id
  await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
  await prisma.user.upsert({
    where: { email: `${handle}@example.test` },
    update: { archivedAt: null, isServiceAccount: role !== "author", role: roleOf[role] },
    create: {
      id,
      email: `${handle}@example.test`,
      handle,
      isServiceAccount: role !== "author",
      name: `T079 ${role}`,
      role: roleOf[role]
    }
  })
  await prisma.handleHistory.update({ where: { handle }, data: { userId: id } })
}

async function seedAuditEntries() {
  const createdAt = new Date()

  await prisma.auditLog.createMany({
    skipDuplicates: true,
    data: [
      {
        id: entryIds.editorial,
        action: "article.archive",
        actorId: userIds.editor,
        actorRole: "editor",
        entityType: "article",
        entityId: `t079-${run}-article`,
        diff: { reason: "t079 editorial" },
        requestId: `t079-${run}-req-editorial`,
        createdAt
      },
      {
        id: entryIds.moderation,
        action: "translation.unpublish",
        actorId: userIds.moderator,
        actorRole: "moderator",
        entityType: "articleTranslation",
        entityId: `t079-${run}-translation`,
        diff: { reason: "t079 moderation" },
        requestId: `t079-${run}-req-moderation`,
        createdAt
      },
      {
        id: entryIds.finance,
        action: "plan.grant",
        actorId: userIds.analyst,
        actorRole: "analyst",
        entityType: "planGrant",
        entityId: `t079-${run}-grant`,
        diff: { tier: "standard" },
        requestId: `t079-${run}-req-finance`,
        createdAt
      },
      {
        id: entryIds.personal,
        action: "admin.read.personal",
        actorId: userIds.analyst,
        actorRole: "analyst",
        entityType: "user",
        entityId: subjectUserId,
        subject: subjectUserId,
        context: `/admin/users/${subjectUserId}`,
        purpose: "user.card.open",
        requestId: `t079-${run}-req-personal`,
        createdAt
      },
      {
        id: entryIds.closed,
        action: "settings.change",
        actorId: userIds.owner,
        actorRole: "owner",
        entityType: "systemSetting",
        entityId: `t079-${run}-setting`,
        diff: { key: "t079" },
        requestId: `t079-${run}-req-closed`,
        createdAt
      },
      {
        id: entryIds.system,
        action: "ai.decision",
        actorId: null,
        actorRole: null,
        entityType: "articleTranslation",
        entityId: `t079-${run}-ai`,
        diff: { verdict: "publish" },
        requestId: `t079-${run}-req-system`,
        createdAt
      }
    ]
  })
}

/** Лимит экспорта считается по самому журналу: десять свежих записей у отдельного администратора. */
async function seedExportLimit() {
  const now = Date.now()
  await prisma.auditLog.createMany({
    data: Array.from({ length: 10 }, (_, index) => ({
      id: `t079-${run}-limit-${index}`,
      action: "stats.export",
      actorId: userIds.limitAdmin,
      actorRole: "admin" as Role,
      entityType: "auditLog",
      entityId: "export",
      diff: { report: "audit", rows: 0 },
      createdAt: new Date(now - (index + 1) * 60_000)
    }))
  })
}

test.describe("admin audit", () => {
  test.describe.configure({ mode: "serial" })

  test.beforeAll(async () => {
    for (const role of [...serviceRoles, "author", "limitAdmin"] as const) await upsertUser(role)
    await seedAuditEntries()
  })

  test.afterAll(async () => prisma.$disconnect())

  test("гостя отправляет на вход с исходным адресом", async ({ page }) => {
    await page.goto("/admin/audit?period=30d")

    await expect(page).toHaveURL(
      (url) => url.pathname === "/login" && url.searchParams.get("next") === "/admin/audit?period=30d"
    )
  })

  test("обычный аккаунт получает 403", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken("author")}` })

    const response = await page.goto("/admin/audit")

    expect(response?.status()).toBe(403)
    await expect(page.locator("[data-audit-row]")).toHaveCount(0)
  })

  for (const [role, visible, hidden] of [
    ["editor", [entryIds.editorial], [entryIds.finance, entryIds.closed, entryIds.personal]],
    ["moderator", [entryIds.moderation, entryIds.system], [entryIds.finance, entryIds.closed]],
    ["analyst", [entryIds.finance, entryIds.personal], [entryIds.moderation, entryIds.closed]],
    ["admin", [entryIds.finance, entryIds.moderation, entryIds.closed], []],
    ["owner", [entryIds.closed, entryIds.editorial], []]
  ] as const) {
    test(`${role} видит только записи своей зоны`, async ({ page }) => {
      await page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken(role)}` })

      const response = await page.goto("/admin/audit?period=30d")

      expect(response?.status()).toBe(200)
      for (const id of visible) await expect(page.locator(`[data-audit-row="${id}"]`)).toBeVisible()
      for (const id of hidden) await expect(page.locator(`[data-audit-row="${id}"]`)).toHaveCount(0)
    })
  }

  test("пустое состояние по фильтру без записей", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken("admin")}` })

    await page.goto(`/admin/audit?requestId=t079-${run}-absent`)

    await expect(page.locator("[data-audit-empty]")).toBeVisible()
    await expect(page.locator("[data-audit-row]")).toHaveCount(0)
  })

  test("состояние загрузки показывает скелеты", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken("admin")}` })
    let release = () => {}
    let started = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    await page.route("**/api/graphql", async (route) => {
      const body = route.request().postDataJSON() as { query?: string }
      if (!body.query?.includes("GetAuditLog")) return route.continue()
      started()
      await gate
      return route.continue()
    })

    await page.goto("/admin/audit?period=30d")
    await requestStarted

    await expect(page.locator("[data-audit-loading]")).toBeVisible()
    release()
    await expect(page.locator(`[data-audit-row="${entryIds.closed}"]`)).toBeVisible()
  })

  test("ошибка запроса показывает requestId", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken("admin")}` })
    await page.route("**/api/graphql", async (route) => {
      const body = route.request().postDataJSON() as { query?: string }
      if (!body.query?.includes("GetAuditLog")) return route.continue()
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          errors: [{ message: "Internal server error", extensions: { code: "INTERNAL_ERROR", requestId: "req-t079" } }]
        })
      })
    })

    await page.goto("/admin/audit")

    const error = page.locator("[data-audit-error]")
    await expect(error).toBeVisible()
    await expect(error).toContainText("req-t079")
  })

  test("запись вне зоны служебной роли отвечает 404, своя запись открывается", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken("editor")}` })

    const forbidden = await page.goto(`/admin/audit?id=${entryIds.finance}`)

    expect(forbidden?.status()).toBe(404)

    await page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken("analyst")}` })
    const allowed = await page.goto(`/admin/audit?id=${entryIds.personal}&period=30d`)

    expect(allowed?.status()).toBe(200)
    await expect(page.locator("[data-audit-detail]")).toContainText("user.card.open")
    await expect(page.locator("[data-audit-detail-subject]")).toContainText(subjectUserId)
  })

  test("фильтры сохраняются в адресе страницы", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken("admin")}` })

    await page.goto(`/admin/audit?entity=user:${subjectUserId}&period=30d`)

    await expect(page.locator(`[data-audit-row="${entryIds.personal}"]`)).toBeVisible()
    await expect(page.locator(`[data-audit-row="${entryIds.closed}"]`)).toHaveCount(0)

    await page.locator("[data-audit-filter-action]").selectOption("settings.change")
    await page.locator("[data-audit-filter-entity-type]").fill("")
    await page.locator("[data-audit-filter-entity-id]").fill("")
    await page.locator("[data-audit-apply]").click()

    await expect(page).toHaveURL((url) => url.searchParams.get("action") === "settings.change")
    await expect(page.locator(`[data-audit-row="${entryIds.closed}"]`)).toBeVisible()
    await expect(page.locator(`[data-audit-row="${entryIds.personal}"]`)).toHaveCount(0)
  })

  // Критерий 2: просмотр аудита не создаёт записей.
  test("просмотр списка и карточки не создаёт записей в журнале", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken("owner")}` })
    // Другие спеки пишут свои записи параллельно, поэтому считаются только акторы этого прогона.
    const testActors = { actorId: { in: Object.values(userIds) } }
    const before = await prisma.auditLog.count({ where: testActors })

    await page.goto("/admin/audit?period=30d")
    await expect(page.locator(`[data-audit-row="${entryIds.closed}"]`)).toBeVisible()
    await page.locator(`[data-audit-open="${entryIds.closed}"]`).click()
    await expect(page.locator("[data-audit-detail]")).toBeVisible()
    await page.locator("[data-audit-refresh]").click()
    await expect(page.locator(`[data-audit-row="${entryIds.closed}"]`)).toBeVisible()

    expect(await prisma.auditLog.count({ where: testActors })).toBe(before)
  })

  test("аналитик не получает кнопку экспорта", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken("analyst")}` })

    await page.goto("/admin/audit?period=30d")

    await expect(page.locator(`[data-audit-row="${entryIds.finance}"]`)).toBeVisible()
    await expect(page.locator("[data-audit-export]")).toHaveCount(0)
  })

  test("экспорт администратора выгружает CSV без полей с ПД и пишет stats.export", async ({ page }) => {
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken("admin")}` })
    const before = await prisma.auditLog.count({ where: { action: "stats.export", actorId: userIds.admin } })

    await page.goto("/admin/audit?period=30d")
    await page.locator("[data-audit-export]").click()
    await expect(page.locator("[data-audit-export-confirm]")).toBeVisible()
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("[data-audit-export-confirm-button]").click()
    ])
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    const csv = Buffer.concat(chunks).toString("utf8")

    expect(csv.split("\n")[0]).toBe("createdAt,action,actorRole,actorKind,entityType,requestId")
    expect(csv).toContain("admin.read.personal")
    expect(csv).not.toContain(subjectUserId)
    expect(csv).not.toContain("user.card.open")
    expect(csv).not.toContain(userIds.analyst)
    await expect(page.locator("[data-audit-exported]")).toBeVisible()
    await expect
      .poll(() => prisma.auditLog.count({ where: { action: "stats.export", actorId: userIds.admin } }))
      .toBe(before + 1)
  })

  test("экспорт чаще лимита показывает RATE_LIMITED", async ({ page }) => {
    await seedExportLimit()
    await page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken("limitAdmin")}` })
    const before = await prisma.auditLog.count({ where: { action: "stats.export", actorId: userIds.limitAdmin } })

    await page.goto("/admin/audit?period=30d")
    await page.locator("[data-audit-export]").click()
    await page.locator("[data-audit-export-confirm-button]").click()

    const alert = page.locator("[data-audit-rate-limited]")
    await expect(alert).toBeVisible()
    await expect(alert).toContainText("RATE_LIMITED")
    expect(await prisma.auditLog.count({ where: { action: "stats.export", actorId: userIds.limitAdmin } })).toBe(before)
  })
})
