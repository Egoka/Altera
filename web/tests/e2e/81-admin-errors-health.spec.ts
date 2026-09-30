import { randomUUID } from "node:crypto"
import { PrismaClient, type Role } from "../../../server/src/generated/prisma/index.js"
import { expect, test } from "./helpers/test"
import { createSessionId, signAccessToken } from "./helpers/session-token"

const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
const run = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
const roles = ["admin", "owner", "analyst", "author", "limitAdmin"] as const
type TestRole = (typeof roles)[number]
const roleOf: Record<TestRole, Role> = {
  admin: "admin",
  owner: "owner",
  analyst: "analyst",
  author: "author",
  limitAdmin: "admin"
}
const userIds = Object.fromEntries(roles.map((role) => [role, `t081-${role.toLowerCase()}`])) as Record<
  TestRole,
  string
>
const sessions = {} as Record<TestRole, string>
const errorId = randomUUID()
const errorCode = `T081_${run}`
const pageSignature = `web:PAGE_ERROR:/t081/${run}`

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
      name: id,
      role: roleOf[role]
    }
  })
  await prisma.handleHistory.update({ where: { handle }, data: { userId: id } })
  sessions[role] = await createSessionId(prisma, id)
}

const authenticate = (role: TestRole) => ({ authorization: `Bearer ${signAccessToken(userIds[role], sessions[role])}` })

async function seedOperationalData() {
  const now = new Date()
  await prisma.backendError.create({
    data: {
      id: errorId,
      signature: `api:${errorCode}:graphql:t081`,
      service: "api",
      code: errorCode,
      errorClass: "Error",
      sanitizedMessage: "Sanitized T081 failure",
      sanitizedStack: "Error: Sanitized T081 failure\n at resolver",
      route: "graphql:t081",
      requestId: `req-${run}`,
      firstSeenAt: now,
      lastSeenAt: now,
      occurrenceCount: 1
    }
  })
  await prisma.backendErrorEvent.createMany({
    data: [
      {
        event: "backend.error",
        stream: "backend",
        service: "api",
        code: errorCode,
        route: "graphql:t081",
        requestId: `req-${run}`,
        message: "Sanitized T081 failure",
        stack: "Error: Sanitized T081 failure\n at resolver",
        signature: `api:${errorCode}:graphql:t081`,
        occurredAt: now
      },
      {
        event: "page.error",
        stream: "page",
        service: "web",
        code: `PAGE_${errorCode}`,
        route: `/t081/${run}`,
        requestId: `page-${run}`,
        signature: pageSignature,
        occurredAt: now
      }
    ]
  })
  await prisma.systemHealthSnapshot.create({
    data: {
      status: "degraded",
      signature: "component.storage.down",
      components: {
        db: { status: "up", adapter: "postgres", latencyMs: 3 },
        storage: { status: "down", adapter: "local", latencyMs: null }
      },
      backups: { database: { status: "ok", ageSeconds: 3600 }, media: { status: "unknown", ageSeconds: null } },
      checkedAt: now
    }
  })
}

test.describe("T-081 admin errors and health", () => {
  test.describe.configure({ mode: "serial" })

  test.beforeAll(async () => {
    for (const role of roles) await upsertUser(role)
    await seedOperationalData()
  })

  test.afterAll(async () => prisma.$disconnect())

  for (const role of ["admin", "owner"] as const) {
    test(`${role} sees backend errors and degraded health`, async ({ page }) => {
      await page.setExtraHTTPHeaders(authenticate(role))
      const response = await page.goto(`/admin/errors?q=${errorCode}`)
      expect(response?.status()).toBe(200)
      await expect(page.locator(`[data-error-row="${errorId}"]`)).toBeVisible()
      await expect(page.locator("[data-health-degraded]")).toBeVisible()
      await expect(page.locator("[data-health-pulse]")).toContainText("storage")
    })
  }

  for (const role of ["analyst", "author"] as const) {
    test(`${role} gets 403`, async ({ page }) => {
      await page.setExtraHTTPHeaders(authenticate(role))
      expect((await page.goto("/admin/errors"))?.status()).toBe(403)
      await expect(page.locator("[data-error-row]")).toHaveCount(0)
    })
  }

  test("shows loading, empty and request error states", async ({ page }) => {
    await page.setExtraHTTPHeaders(authenticate("admin"))
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    await page.route("**/api/graphql", async (route) => {
      const body = route.request().postDataJSON() as { query?: string }
      if (!body.query?.includes("GetAdminErrors")) return route.continue()
      await gate
      return route.continue()
    })
    await page.goto(`/admin/errors?q=${errorCode}`)
    await expect(page.locator("[data-errors-loading]")).toBeVisible()
    release()
    await expect(page.locator(`[data-error-row="${errorId}"]`)).toBeVisible()

    await page.unrouteAll({ behavior: "wait" })
    await page.goto(`/admin/errors?q=t081-absent-${run}`)
    await expect(page.locator("[data-errors-empty]")).toBeVisible()

    await page.route("**/api/graphql", async (route) => {
      const body = route.request().postDataJSON() as { query?: string }
      if (!body.query?.includes("GetAdminErrors")) return route.continue()
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          errors: [{ message: "failed", extensions: { code: "INTERNAL_ERROR", requestId: "req-t081-ui" } }]
        })
      })
    })
    await page.reload()
    await expect(page.locator("[data-errors-error]")).toContainText("req-t081-ui")
  })

  test("keeps page errors separate and without work controls", async ({ page }) => {
    await page.setExtraHTTPHeaders(authenticate("admin"))
    await page.goto(`/admin/errors?stream=page&q=page-${run}`)
    await expect(page.locator(`[data-error-row="${pageSignature}"]`)).toBeVisible()
    await expect(page.locator(`[data-error-select="${pageSignature}"]`)).toHaveCount(0)
  })

  test("renders the frequency chart and complete health details and checks health now", async ({ page }) => {
    await page.setExtraHTTPHeaders(authenticate("admin"))
    await page.goto(`/admin/errors?tab=charts&q=${errorCode}`)
    await expect(page.locator("[data-error-frequency-chart]")).toBeVisible()

    await page.goto("/admin/errors?tab=health")
    await expect(page.locator("[data-health-history]")).toContainText("storage: down · local")
    await expect(page.locator("[data-health-history]")).toContainText("database: ok")

    let checks = 0
    await page.route("**/health", async (route) => {
      checks += 1
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "ok" }) })
    })
    await page.locator("[data-health-check-now]").click()
    await expect.poll(() => checks).toBe(1)
  })

  test("changes status with audit and reports a stale-card conflict", async ({ page }) => {
    await page.setExtraHTTPHeaders(authenticate("admin"))
    await page.goto(`/admin/errors/${errorId}`)
    await expect(page.locator(`[data-error-detail="${errorId}"]`)).toBeVisible()
    await page.locator('[data-error-status="in_progress"]').click()
    await expect(page.locator('[data-error-status="in_progress"]')).toBeDisabled()
    await expect
      .poll(() =>
        prisma.auditLog.count({ where: { action: "admin.change", entityType: "errorWorkItem", entityId: errorId } })
      )
      .toBe(1)
    // Кнопки заблокированы, пока страница перечитывает карточку после смены статуса. Правка «другого
    // сотрудника» должна случиться после этого перечитывания, иначе оно подхватит свежий `updatedAt`.
    await expect(page.locator('[data-error-status="resolved"]')).toBeEnabled()

    await prisma.backendError.update({ where: { id: errorId }, data: { sanitizedMessage: "Changed concurrently" } })
    await page.locator('[data-error-status="resolved"]').click()
    await expect(page.locator("[data-error-detail-conflict]")).toContainText("CONFLICT")
  })

  test("exports safe CSV and writes stats.export", async ({ page }) => {
    await page.setExtraHTTPHeaders(authenticate("owner"))
    const before = await prisma.auditLog.count({
      where: { action: "stats.export", actorId: userIds.owner, entityType: "backendErrorExport" }
    })
    await page.goto(`/admin/errors?q=${errorCode}`)
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-errors-export]").click()])
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    const csv = Buffer.concat(chunks).toString("utf8")
    expect(csv.split("\n")[0]).toBe("lastSeenAt,service,code,route,requestId,occurrences,workStatus")
    expect(csv).toContain(errorCode)
    expect(csv).not.toContain("Sanitized T081 failure")
    expect(csv).not.toContain("at resolver")
    await expect
      .poll(() =>
        prisma.auditLog.count({
          where: { action: "stats.export", actorId: userIds.owner, entityType: "backendErrorExport" }
        })
      )
      .toBe(before + 1)
  })

  test("shows RATE_LIMITED for an exhausted export bucket", async ({ page }) => {
    const now = Date.now()
    await prisma.auditLog.createMany({
      data: Array.from({ length: 10 }, (_, index) => ({
        id: `t081-${run}-limit-${index}`,
        action: "stats.export",
        actorId: userIds.limitAdmin,
        actorRole: "admin" as Role,
        entityType: "backendErrorExport",
        entityId: `t081-${index}`,
        diff: { rows: 0 },
        createdAt: new Date(now - (index + 1) * 1_000)
      }))
    })
    await page.setExtraHTTPHeaders(authenticate("limitAdmin"))
    await page.goto(`/admin/errors?q=${errorCode}`)
    await page.locator("[data-errors-export]").click()
    await expect(page.locator("[data-errors-rate-limited]")).toContainText("RATE_LIMITED")
  })
})
