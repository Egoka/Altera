import { expect, test, type Page } from "./helpers/test"
import { PrismaClient } from "../../../server/src/generated/prisma/index.js"
import { createSessionId, signAccessToken } from "./helpers/session-token"

// Строки состояний docs/spec/40-admin/system-settings.md §9 и доступ §2 (T-082).
const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const accessSecret = "t009-test-access-secret"
// Секреты, которые получает API из playwright.config.ts; ни один не должен дойти до браузера.
const serverSecrets = [accessSecret, "t009-test-refresh-secret", "t053-test-log-hash-secret", "t087-e2e-forward-secret"]
const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
const roles = ["admin", "owner", "editor"] as const
type TestRole = (typeof roles)[number]

// После T-023 токен авторизует запрос только вместе с живой сессией (ADR-0009 п. 3).
const sessionIds = Object.fromEntries(roles.map((role) => [role, ""])) as Record<TestRole, string>

const signToken = (role: TestRole) => signAccessToken(`t082-${role}`, sessionIds[role])

const signIn = (page: Page, role: TestRole) => page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken(role)}` })

const isSettingsQuery = (body: unknown) =>
  typeof body === "object" && body !== null && String(Reflect.get(body, "query")).includes("GetSystemSettings")

test.describe("admin system settings", () => {
  test.beforeAll(async () => {
    for (const role of roles) {
      const handle = `t082-${role}`
      await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
      await prisma.user.upsert({
        where: { email: `${handle}@example.test` },
        update: { archivedAt: null, isServiceAccount: true, role },
        create: {
          id: handle,
          email: `${handle}@example.test`,
          handle,
          isServiceAccount: true,
          name: `T082 ${role}`,
          role
        }
      })
      await prisma.handleHistory.update({ where: { handle }, data: { userId: handle } })
      sessionIds[role] = await createSessionId(prisma, handle)
    }
  })

  test.afterAll(async () => {
    await prisma.$disconnect()
  })

  test("admin reads mail settings without secrets and sees that changes belong to the owner", async ({ page }) => {
    await signIn(page, "admin")

    const response = await page.goto("/admin/settings?group=mail")

    expect(response?.status()).toBe(200)
    await expect(page.locator('[data-settings-panel="mail"]')).toBeVisible()
    await expect(page.locator("[data-settings-adapter]")).toHaveText("smtp")
    await expect(page.locator('[data-setting="SMTP_HOST"]')).toContainText("127.0.0.1")
    await expect(page.locator('[data-setting="SMTP_PASSWORD"]')).toContainText("не задано")
    await expect(page.locator("[data-settings-readonly]")).toContainText("Только чтение")
    await expect(page.locator("[data-settings-permission]")).toHaveText("Изменения — владелец.")
    const html = await page.content()
    for (const secret of serverSecrets) expect(html).not.toContain(secret)
    await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", "noindex,nofollow")
  })

  test("API response carries no secret values for any group", async ({ page }) => {
    for (const group of ["ai", "payments", "mail", "storage", "domains", "limits"]) {
      const response = await page.request.post("/api/graphql", {
        headers: { authorization: `Bearer ${signToken("owner")}` },
        data: {
          query:
            "query($group: SystemSettingsGroup!) { systemSettings(group: $group) { group adapter canChange settings { key source secret configured value mask } } }",
          variables: { group }
        }
      })
      const body = await response.text()

      expect(response.status()).toBe(200)
      expect(JSON.parse(body).data.systemSettings).toMatchObject({ group, canChange: false })
      for (const secret of serverSecrets) expect(body).not.toContain(secret)
    }
  })

  test("owner sees that changes arrive in stage 4 and switches groups through the URL", async ({ page }) => {
    await signIn(page, "owner")
    await page.goto("/admin/settings")
    await expect(page.locator('[data-settings-panel="ai"]')).toBeVisible()
    await expect(page.locator("[data-settings-permission]")).toHaveText(
      "Изменение настроек из интерфейса появится на этапе 4."
    )

    await page.locator('[data-settings-group="payments"]').click()

    await expect(page).toHaveURL((url) => url.searchParams.get("group") === "payments")
    await expect(page.locator('[data-settings-panel="payments"]')).toContainText("Провайдер группы ещё не подключён.")
    await expect(page.locator("[data-settings-none]")).toBeVisible()
  })

  test("shows the skeleton while a group is loading", async ({ page }) => {
    await signIn(page, "admin")
    await page.goto("/admin/settings?group=domains")
    await expect(page.locator('[data-settings-panel="domains"]')).toBeVisible()
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route("**/api/graphql", async (route) => {
      if (!isSettingsQuery(route.request().postDataJSON())) return route.continue()
      await gate
      await route.continue()
    })

    await page.locator('[data-settings-group="mail"]').click()

    await expect(page.locator("[data-settings-loading]")).toBeVisible()
    release()
    await expect(page.locator('[data-settings-panel="mail"]')).toBeVisible()
    await expect(page.locator("[data-settings-loading]")).toHaveCount(0)
  })

  test("shows the error with requestId and recovers on retry", async ({ page }) => {
    await signIn(page, "admin")
    let fail = true
    await page.route("**/api/graphql", async (route) => {
      if (!fail || !isSettingsQuery(route.request().postDataJSON())) return route.continue()
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: null,
          errors: [{ message: "Internal server error", extensions: { code: "INTERNAL_ERROR", requestId: "req-t082" } }]
        })
      })
    })

    await page.goto("/admin/settings?group=mail")

    await expect(page.locator("[data-settings-error]")).toContainText("req-t082")
    fail = false
    await page.locator("[data-settings-error] button").click()
    await expect(page.locator("[data-settings-error]")).toHaveCount(0)
    await expect(page.locator('[data-settings-panel="mail"]')).toBeVisible()
  })

  test("editor receives HTTP 403", async ({ page }) => {
    await signIn(page, "editor")

    const response = await page.goto("/admin/settings")

    expect(response?.status()).toBe(403)
    await expect(page.locator("[data-settings-panel]")).toHaveCount(0)
  })

  test("guest is redirected to login with the original target", async ({ page }) => {
    await page.goto("/admin/settings?group=limits")

    await expect(page).toHaveURL(
      (url) => url.pathname === "/login" && url.searchParams.get("next") === "/admin/settings?group=limits"
    )
  })
})
