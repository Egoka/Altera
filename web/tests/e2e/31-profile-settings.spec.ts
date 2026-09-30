import { expect, test as base, type Page } from "./helpers/test"

// Все ответы этого файла подменены на границе BFF; база не участвует, поэтому автоматическая
// очистка общей корзины здесь только делала сценарий зависимым от локальных реквизитов Postgres.
const test = base.extend({
  freshRateLimits: [
    async ({}, use) => {
      await use()
    },
    { auto: true }
  ]
})

const openSettingsInBrowser = async (page: Page): Promise<void> => {
  // Прямой SSR-запрос гостя закономерно уходит на `/login`. Клиентский переход проверяет саму
  // страницу с подменённым BFF: middleware и запрос профиля получают одну и ту же фикстуру.
  await page.goto("/login")
  await page.evaluate(() => {
    window.history.pushState({}, "", "/me/settings")
    window.dispatchEvent(new PopStateEvent("popstate"))
  })
  await page.waitForURL(/\/me\/settings$/)
}

const profile = (overrides: Record<string, unknown> = {}) => ({
  id: "user-1",
  name: "Вера",
  email: "vera@example.test",
  bio: "Пишу о культуре",
  photoUrl: null,
  role: "reader",
  handle: "vera",
  handleConfirmed: true,
  handleChangedAt: null,
  locale: "ru",
  avatarAssetId: null,
  prevAvatarId: null,
  nameCheckStatus: "ok",
  pendingName: null,
  nameCheckReason: null,
  avatarCheckStatus: "ok",
  avatarCheckReason: null,
  socialLinks: null,
  archivedAt: null,
  avatar: null,
  createdAt: "2026-09-28T10:00:00.000Z",
  ...overrides
})

test("T-031: профиль показывает готовность, живую проверку адреса и сохраняет изменения", async ({ page }) => {
  let savedInput: Record<string, unknown> | null = null
  await page.route("**/api/graphql", async (route) => {
    const body = route.request().postDataJSON() as { query: string; variables?: Record<string, unknown> }
    const payload = body.query.includes("CheckHandle")
      ? { data: { checkHandle: { handle: "vera-new", available: true } } }
      : body.query.includes("UpdateProfile")
        ? ((savedInput = body.variables?.input as Record<string, unknown>),
          {
            data: { updateProfile: profile({ handle: "vera-new" }) }
          })
        : { data: { me: profile(), myArticlesStats: null } }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) })
  })

  await openSettingsInBrowser(page)
  await expect(page.locator("[data-profile-state='ready']")).toBeVisible()
  await expect(page.getByTestId("profile-publish-ready")).toHaveAttribute("data-ready", "true")
  await page.getByTestId("profile-handle").fill("vera-new")
  await page.getByTestId("profile-handle").blur()
  await expect(page.getByTestId("profile-handle-status")).toBeVisible()
  await page.getByTestId("profile-form").evaluate((form) => (form as HTMLFormElement).requestSubmit())
  await expect(page.getByTestId("profile-saved")).toBeVisible()
  expect(savedInput).toMatchObject({ handle: "vera-new", name: "Вера", locale: "ru" })
})

test("T-031: состояния проверки имени и аватара воспроизводимы", async ({ page }) => {
  let current = profile({
    pendingName: "Новое имя",
    nameCheckStatus: "pending",
    avatarCheckStatus: "pending"
  })
  await page.route("**/api/graphql", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { me: current, myArticlesStats: null } })
    })
  })

  await openSettingsInBrowser(page)
  await expect(page.getByTestId("profile-name-status")).toBeVisible()
  await expect(page.getByTestId("profile-avatar-status")).toBeVisible()

  current = profile({
    nameCheckStatus: "rejected",
    nameCheckReason: "Используйте настоящее имя",
    avatarCheckStatus: "rejected",
    avatarCheckReason: "Изображение нарушает правила"
  })
  await openSettingsInBrowser(page)
  await expect(page.getByTestId("profile-name-status")).toContainText("Используйте настоящее имя")
  await expect(page.getByTestId("profile-avatar-status")).toContainText("Изображение нарушает правила")
})

test("T-031: ошибка данных и служебный аккаунт имеют отдельные состояния", async ({ page }) => {
  let payload: Record<string, unknown> = {
    data: null,
    errors: [{ extensions: { code: "INTERNAL_ERROR", requestId: "req-profile" } }]
  }
  await page.route("**/api/graphql", async (route) => {
    const body = route.request().postDataJSON() as { query: string }
    const response = body.query.includes("GetMyProfile") ? payload : { data: { me: profile() } }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) })
  })

  await openSettingsInBrowser(page)
  await expect(page.locator("[data-profile-state='data_error']")).toBeVisible()

  payload = { data: { me: profile({ role: "moderator" }), myArticlesStats: null } }
  await openSettingsInBrowser(page)
  await expect(page.locator("[data-profile-state='forbidden']")).toBeVisible()
})

test("T-031: гость уходит на вход с путём возврата", async ({ page }) => {
  await page.route("**/api/graphql", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { me: null }, errors: [{ extensions: { code: "UNAUTHENTICATED" } }] })
    })
  })
  await page.goto("/me/settings")
  await expect(page).toHaveURL(/\/login\?next=\/me\/settings$/)
})
