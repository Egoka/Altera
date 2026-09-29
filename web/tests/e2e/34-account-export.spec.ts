import { expect, test, type Page, type Route } from "./helpers/test"
import { uniqueEmail } from "./helpers/auth-fixtures"
import { createSessionId, signAccessToken } from "./helpers/session-token"
import { SESSION_ACCESS_COOKIE } from "../../shared/session"

const authenticate = async (page: Page, database: Parameters<typeof createSessionId>[0]) => {
  const suffix = Math.random().toString(16).slice(2, 10)
  const handle = `t034-${suffix}`
  await database.handleHistory.create({ data: { handle } })
  const user = await database.user.create({
    data: { email: uniqueEmail("t034"), handle, name: "Автор выгрузки", role: "author" }
  })
  await database.handleHistory.update({ where: { handle }, data: { userId: user.id } })
  const sessionId = await createSessionId(database, user.id)
  await page.context().addCookies([
    {
      name: SESSION_ACCESS_COOKIE,
      value: signAccessToken(user.id, sessionId),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }
  ])
}

const fulfill = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })

const exportItem = (status: string) => ({
  id: `export-${status}`,
  requestedAt: "2026-09-29T09:00:00.000Z",
  status,
  sizeBytes: status === "ready" ? 4096 : null,
  expiresAt: status === "ready" ? "2026-10-06T09:00:00.000Z" : null,
  scope: ["profile", "articles", "media", "review"]
})

test("/me/export воспроизводит пустое и все состояния фонового задания", async ({ page, database }) => {
  await authenticate(page, database)
  await page.route("**/api/graphql", async (route) => {
    const query = (route.request().postDataJSON() as { query?: string }).query ?? ""
    if (!query.includes("GetMyAccountExports")) return route.fallback()
    return fulfill(route, {
      data: {
        me: {
          id: "user-1",
          exports: ["queued", "running", "stuck", "ready", "failed", "expired"].map(exportItem)
        }
      }
    })
  })

  await page.goto("/me/export")
  await expect(page.locator('[data-export-status="queued"]')).toContainText("В очереди")
  await expect(page.locator('[data-export-status="running"]')).toContainText("Готовим архив")
  await expect(page.locator('[data-export-status="stuck"]')).toContainText("Готовим дольше обычного")
  await expect(page.locator('[data-export-status="ready"]')).toContainText("Готово к скачиванию")
  await expect(page.locator('[data-export-status="failed"]')).toContainText("Не удалось подготовить")
  await expect(page.locator('[data-export-status="expired"]')).toContainText("Срок хранения истёк")
  await expect(page.getByRole("button", { name: "Скачать ZIP" })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow")
})

test("загрузка переходит в воспроизводимую ошибку данных", async ({ page, database }) => {
  await authenticate(page, database)
  await page.route("**/api/graphql", async (route) => {
    const query = (route.request().postDataJSON() as { query?: string }).query ?? ""
    if (!query.includes("GetMyAccountExports")) return route.fallback()
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    return fulfill(route, { data: null, errors: [{ extensions: { code: "INTERNAL_ERROR" } }] })
  })

  await page.goto("/me/export")
  await expect(page.locator('[data-export-state="loading"]')).toBeVisible()
  await expect(page.locator('[data-export-state="data_error"]')).toBeVisible()
  await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible()
})

test("пустая история и суточный лимит показаны без paywall", async ({ page, database }) => {
  await authenticate(page, database)
  await page.route("**/api/graphql", async (route) => {
    const query = (route.request().postDataJSON() as { query?: string }).query ?? ""
    if (query.includes("GetMyAccountExports")) {
      return fulfill(route, { data: { me: { id: "user-1", exports: [] } } })
    }
    if (query.includes("RequestAccountExport")) {
      return fulfill(route, { data: null, errors: [{ extensions: { code: "RATE_LIMITED", retryAfter: 3600 } }] })
    }
    return route.fallback()
  })

  await page.goto("/me/export")
  await expect(page.getByTestId("export-empty")).toHaveText("Выгрузок пока не было.")
  await page.getByRole("button", { name: "Запросить выгрузку" }).click()
  await expect(page.getByTestId("export-notice")).toHaveText("Новую выгрузку можно запросить через 60 мин.")
  await expect(page.getByText(/paywall/i)).toHaveCount(0)
})

test("гость уходит на вход с адресом возврата", async ({ page }) => {
  await page.goto("/me/export")
  await expect(page).toHaveURL(/\/login\?next=(%2Fme%2Fexport|\/me\/export)$/)
})
