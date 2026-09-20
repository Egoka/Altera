import { expect, test, type Page } from "@playwright/test"
import { createHmac } from "node:crypto"
import { PrismaClient } from "../../../server/src/generated/prisma/index.js"

const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const accessSecret = "t009-test-access-secret"
const prisma = new PrismaClient({ datasourceUrl: databaseUrl })

const roles = ["admin", "owner"] as const
type JobsRole = (typeof roles)[number]
const userIds: Record<JobsRole, string> = { admin: "t077-admin", owner: "t077-owner" }

// Идентификаторы заданий — настоящие UUID: массовый повтор адресуется теми же значениями.
const FAILED_JOB = "77000000-0000-4000-8000-000000000001"
const STUCK_JOB = "77000000-0000-4000-8000-000000000002"
const RUNNING_JOB = "77000000-0000-4000-8000-000000000003"
const CONFLICT_JOB = "77000000-0000-4000-8000-000000000004"
const seededJobs = [FAILED_JOB, STUCK_JOB, RUNNING_JOB, CONFLICT_JOB]

function signToken(role: JobsRole) {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const encodedPayload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900, role, userId: userIds[role] })
  ).toString("base64url")
  const unsigned = `${encodedHeader}.${encodedPayload}`
  return `${unsigned}.${createHmac("sha256", accessSecret).update(unsigned).digest("base64url")}`
}

async function upsertUser(role: JobsRole) {
  const id = userIds[role]
  const handle = `t077-${role}`
  await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
  await prisma.user.upsert({
    where: { email: `${handle}@example.test` },
    update: { archivedAt: null, isServiceAccount: true, role },
    create: { id, email: `${handle}@example.test`, handle, isServiceAccount: true, name: `T077 ${role}`, role }
  })
  await prisma.handleHistory.update({ where: { handle }, data: { userId: id } })
}

// Записи аудита неизменяемы на уровне базы, поэтому пересев их не удаляет:
// проверки ищут запись, созданную после текущего пересева.
async function seedJobs() {
  const now = new Date()
  await prisma.job.deleteMany({ where: { id: { in: seededJobs } } })
  await prisma.job.createMany({
    data: [
      {
        id: FAILED_JOB,
        kind: "ai.check",
        status: "failed",
        objectType: "Article",
        objectId: "t077-object",
        parameters: { articleId: "t077-object" },
        attemptCount: 3,
        maxAttempts: 3,
        createdAt: new Date(now.getTime() - 60_000),
        startedAt: new Date(now.getTime() - 55_000),
        finishedAt: new Date(now.getTime() - 40_000)
      },
      {
        id: STUCK_JOB,
        kind: "mail",
        status: "stuck",
        attemptCount: 1,
        createdAt: new Date(now.getTime() - 120_000),
        startedAt: new Date(now.getTime() - 110_000),
        finishedAt: new Date(now.getTime() - 20_000)
      },
      {
        id: RUNNING_JOB,
        kind: "export",
        status: "running",
        attemptCount: 1,
        createdAt: new Date(now.getTime() - 30_000),
        startedAt: new Date(now.getTime() - 25_000)
      },
      {
        id: CONFLICT_JOB,
        kind: "ai.translate",
        status: "failed",
        attemptCount: 2,
        maxAttempts: 2,
        createdAt: new Date(now.getTime() - 90_000),
        startedAt: new Date(now.getTime() - 85_000),
        finishedAt: new Date(now.getTime() - 70_000)
      }
    ]
  })
  await prisma.jobAttempt.deleteMany({ where: { jobId: { in: seededJobs } } })
  await prisma.jobAttempt.create({
    data: {
      jobId: FAILED_JOB,
      number: 3,
      status: "failed",
      startedAt: new Date(now.getTime() - 55_000),
      finishedAt: new Date(now.getTime() - 40_000),
      errorClass: "ProviderError",
      errorRequestId: "t077-request"
    }
  })
}

async function signIn(page: Page, role: JobsRole) {
  await page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken(role)}` })
}

const isOperation = (route: { request(): { postDataJSON(): unknown } }, name: string) => {
  const body = route.request().postDataJSON() as { query?: string } | null
  return Boolean(body?.query?.includes(name))
}

test.describe("admin jobs section", () => {
  test.describe.configure({ mode: "serial" })

  test.beforeAll(async () => {
    for (const role of roles) await upsertUser(role)
  })

  let seededAt = new Date()

  test.beforeEach(async () => {
    await seedJobs()
    // Секунда запаса: отметка берётся с машины теста, а `createdAt` — с часов базы.
    seededAt = new Date(Date.now() - 1_000)
  })

  const lastAudit = (entityId: string) =>
    prisma.auditLog.findFirst({
      where: { entityType: "Job", entityId, createdAt: { gte: seededAt } },
      orderBy: { createdAt: "desc" }
    })

  test.afterAll(async () => {
    await prisma.job.deleteMany({ where: { id: { in: seededJobs } } })
    await prisma.$disconnect()
  })

  test("admin reads the queue but gets no retry or cancel controls", async ({ page }) => {
    await signIn(page, "admin")

    const response = await page.goto("/admin/jobs")

    expect(response?.status()).toBe(200)
    await expect(page.locator(`[data-job-row="${FAILED_JOB}"]`)).toBeVisible()
    await expect(page.locator("[data-jobs-no-actions]")).toContainText("Действия — владелец")
    await expect(page.locator(`[data-job-retry="${FAILED_JOB}"]`)).toHaveCount(0)
    await expect(page.locator(`[data-job-cancel="${RUNNING_JOB}"]`)).toHaveCount(0)
  })

  test("shows the loading skeleton until the queue answers", async ({ page }) => {
    await signIn(page, "admin")
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route("**/api/graphql", async (route) => {
      if (!isOperation(route, "GetAdminJobs")) return route.continue()
      await gate
      return route.continue()
    })

    await page.goto("/admin/jobs")

    await expect(page.locator("[data-jobs-loading]")).toBeVisible()
    release()
    await expect(page.locator(`[data-job-row="${FAILED_JOB}"]`)).toBeVisible()
  })

  test("shows the empty state when no job matches the filter", async ({ page }) => {
    await signIn(page, "admin")

    await page.goto("/admin/jobs?object=t077-no-such-object")

    await expect(page.locator("[data-jobs-empty]")).toContainText("Ошибок и зависших нет")
  })

  test("shows the failed request with its requestId", async ({ page }) => {
    await signIn(page, "admin")
    await page.route("**/api/graphql", async (route) => {
      if (!isOperation(route, "GetAdminJobs")) return route.continue()
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          errors: [{ message: "Internal server error", extensions: { code: "INTERNAL_ERROR", requestId: "req-jobs" } }]
        })
      })
    })

    await page.goto("/admin/jobs")

    await expect(page.getByRole("alert").filter({ hasText: "requestId: req-jobs" })).toBeVisible()
  })

  test("keeps the stuck filter in the address and narrows the list", async ({ page }) => {
    await signIn(page, "admin")
    await page.goto("/admin/jobs")

    await page.locator("[data-jobs-stuck]").click()

    await expect(page).toHaveURL((url) => url.searchParams.get("stuck") === "1")
    await expect(page.locator(`[data-job-row="${STUCK_JOB}"]`)).toBeVisible()
    await expect(page.locator(`[data-job-row="${FAILED_JOB}"]`)).toHaveCount(0)
  })

  test("opens the job card with parameters and attempt history", async ({ page }) => {
    await signIn(page, "admin")
    await page.goto("/admin/jobs")

    await page.locator(`[data-job-open="${FAILED_JOB}"]`).click()

    const card = page.locator("[data-job-card]")
    await expect(card).toContainText("articleId")
    await expect(card.locator('[data-job-attempt="3"]')).toContainText("ProviderError")
  })

  test("owner retries a failed job and the retry is audited", async ({ page }) => {
    await signIn(page, "owner")
    await page.goto("/admin/jobs")

    await page.locator(`[data-job-retry="${FAILED_JOB}"]`).click()
    await expect(page.locator(`[data-job-row="${FAILED_JOB}"]`)).toHaveCount(0)

    const job = await prisma.job.findUniqueOrThrow({ where: { id: FAILED_JOB }, select: { status: true } })
    expect(job.status).toBe("queued")
    const audit = await lastAudit(FAILED_JOB)
    expect(audit?.action).toBe("job.retry")
    expect(audit?.actorRole).toBe("owner")
  })

  test("owner cancels a running job only with a reason", async ({ page }) => {
    await signIn(page, "owner")
    await page.goto("/admin/jobs?status=running")

    await page.locator(`[data-job-cancel="${RUNNING_JOB}"]`).click()
    await expect(page.locator("[data-jobs-cancel-confirm]")).toBeDisabled()
    await page.locator("[data-jobs-cancel-reason]").fill("дубль выгрузки")
    await page.locator("[data-jobs-cancel-confirm]").click()

    await expect(page.locator(`[data-job-row="${RUNNING_JOB}"]`)).toHaveCount(0)
    const job = await prisma.job.findUniqueOrThrow({ where: { id: RUNNING_JOB }, select: { status: true } })
    expect(job.status).toBe("cancelled")
    const audit = await lastAudit(RUNNING_JOB)
    expect(audit?.action).toBe("job.cancel")
    expect(audit?.diff).toMatchObject({ reason: "дубль выгрузки" })
  })

  test("reports the conflict when the job changed under the operator", async ({ page }) => {
    await signIn(page, "owner")
    await page.goto("/admin/jobs")
    await expect(page.locator(`[data-job-retry="${CONFLICT_JOB}"]`)).toBeVisible()

    await prisma.job.update({ where: { id: CONFLICT_JOB }, data: { status: "completed" } })
    await page.locator(`[data-job-retry="${CONFLICT_JOB}"]`).click()

    await expect(page.locator("[data-jobs-conflict]")).toBeVisible()
  })

  test("reports the bulk retry limit rejected by the server", async ({ page }) => {
    await signIn(page, "owner")
    await page.route("**/api/graphql", async (route) => {
      if (!isOperation(route, "RetryJobs")) return route.continue()
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          errors: [
            {
              message: "Validation failed",
              extensions: { code: "VALIDATION_ERROR", requestId: "req-bulk", field: "ids", rule: "maxItems:100" }
            }
          ]
        })
      })
    })
    await page.goto("/admin/jobs")

    await page.locator(`[data-job-select="${FAILED_JOB}"]`).check()
    await page.locator("[data-jobs-bulk-open]").click()
    await expect(page.locator("[data-jobs-bulk-modal]")).toContainText("ai.check")
    await page.locator("[data-jobs-bulk-confirm]").click()

    await expect(page.locator("[data-jobs-limit]")).toContainText("100")
  })
})
