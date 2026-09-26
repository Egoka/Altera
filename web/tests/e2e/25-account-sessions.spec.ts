import { expect, test, type Page, type Route } from "./helpers/test"
import { uniqueEmail, withPrisma } from "./helpers/auth-fixtures"
import { createSessionId, signAccessToken } from "./helpers/session-token"
import { SESSION_ACCESS_COOKIE } from "../../shared/session"

/**
 * T-025: страница «Сессии и устройства» (`docs/spec/30-account/reader/sessions.md`).
 * AC-1 — все строки состояний §8 воспроизводимы; AC-2 — в ответе API нет поля геолокации.
 *
 * Вход здесь не проходит по ссылке намеренно: сессии кладутся в базу напрямую, чтобы сценарий
 * не расходовал общую корзину `auth.verify.ip` (`rate-limits.md` §2 п. 3) вместе с T-022.
 */

const REFRESH_COOKIE = "altera_refresh"

const CHROME_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
const SAFARI_PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

interface DeviceInput {
  userAgent: string | null
  ip: string | null
  lastUsedAt?: Date
}

interface Account {
  id: string
  email: string
  sessionIds: string[]
}

const createAccount = async (prefix: string, devices: DeviceInput[], archived = false): Promise<Account> =>
  withPrisma(async (prisma) => {
    const handle = `${prefix}-${Math.random().toString(16).slice(2, 10)}`
    await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(prefix),
        handle,
        name: "T025 account",
        ...(archived ? { archivedAt: new Date(), archiveMode: "self" as const } : {})
      }
    })
    await prisma.handleHistory.update({ where: { handle }, data: { userId: user.id } })

    const sessionIds: string[] = []
    for (const device of devices) {
      const id = await createSessionId(prisma, user.id)
      await prisma.session.update({
        where: { id },
        data: {
          userAgent: device.userAgent,
          ip: device.ip,
          ...(device.lastUsedAt ? { lastUsedAt: device.lastUsedAt } : {})
        }
      })
      sessionIds.push(id)
    }

    return { id: user.id, email: user.email, sessionIds }
  })

const useSession = async (page: Page, account: Account, index = 0): Promise<void> => {
  await page.context().addCookies([
    {
      name: SESSION_ACCESS_COOKIE,
      value: signAccessToken(account.id, account.sessionIds[index]!),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }
  ])
}

/** Подменяет ответ одной операции: строки §8, зависящие от отказа сервера, иначе не снять. */
const stubOperation = (page: Page, operation: string, handle: (route: Route) => Promise<void>) =>
  page.route("**/api/graphql", async (route) => {
    const body = route.request().postDataJSON() as { query?: string } | null
    if (typeof body?.query === "string" && body.query.includes(operation)) {
      await handle(route)
      return
    }
    await route.fallback()
  })

const graphQLError = (code: string) =>
  JSON.stringify({ data: null, errors: [{ message: code, extensions: { code, requestId: "e2e-t025" } }] })

const desktopAndPhone = (): DeviceInput[] => [
  { userAgent: CHROME_DESKTOP, ip: "203.0.113.10" },
  { userAgent: SAFARI_PHONE, ip: "198.51.100.7", lastUsedAt: new Date(Date.now() - 3_600_000) }
]

const activeSessions = (email: string) =>
  withPrisma((prisma) => prisma.session.findMany({ where: { user: { email }, revokedAt: null } }))

test.describe("страница сессий: строки состояний §8", () => {
  test("«Нет доступа»: гость уходит на вход с путём возврата", async ({ page }) => {
    await page.goto("/me/sessions")

    await expect(page).toHaveURL(/\/login\?next=%2Fme%2Fsessions|\/login\?next=\/me\/sessions/)
  })

  test("«Загрузка» и «Пусто»: одна сессия показывает скелет, затем пустое состояние", async ({ page }) => {
    const account = await createAccount("t025-empty", [{ userAgent: CHROME_DESKTOP, ip: "203.0.113.10" }])
    await useSession(page, account)

    // Чтение задерживается, чтобы «Загрузка» успела стать наблюдаемой строкой, а не мельканием.
    await stubOperation(page, "GetMySessions", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      await route.fallback()
    })

    await page.goto("/me/sessions")
    await expect(page.getByTestId("sessions-skeleton")).toBeVisible()
    expect(await page.locator("[data-sessions-state]").getAttribute("data-sessions-state")).toBe("loading")

    await expect(page.getByTestId("sessions-empty")).toBeVisible()
    await expect(page.getByTestId("sessions-logout-all")).toHaveCount(0)
    await expect(page.getByTestId("session-row-" + account.sessionIds[0])).toBeVisible()
  })

  test("«Ошибка данных»: отказ чтения показывает сообщение и кнопку повтора", async ({ page }) => {
    const account = await createAccount("t025-error", desktopAndPhone())
    await useSession(page, account)
    await stubOperation(page, "GetMySessions", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: graphQLError("INTERNAL_ERROR") })
    )

    await page.goto("/me/sessions")

    await expect(page.getByTestId("sessions-data-error")).toBeVisible()
    await expect(page.getByTestId("sessions-retry")).toBeVisible()
  })

  test("«Заблокирован»: ограниченная сессия уходит на экран состояния", async ({ page }) => {
    const account = await createAccount("t025-archived", [{ userAgent: CHROME_DESKTOP, ip: null }], true)
    await useSession(page, account)

    await page.goto("/me/sessions")

    await expect(page).toHaveURL(/\/me\/archived$/)
  })

  test("«Не найдено»: отзыв уже завершённой сессии убирает строку с уведомлением", async ({ page }) => {
    const account = await createAccount("t025-gone", desktopAndPhone())
    await useSession(page, account)
    await page.goto("/me/sessions")
    await expect(page.getByTestId(`session-row-${account.sessionIds[1]}`)).toBeVisible()

    // Сессию закрывает другое устройство ровно между чтением списка и нажатием «отозвать».
    await withPrisma((prisma) =>
      prisma.session.update({ where: { id: account.sessionIds[1]! }, data: { revokedAt: new Date() } })
    )
    await page.getByTestId(`session-row-${account.sessionIds[1]}`).getByTestId("session-revoke").click()

    await expect(page.getByTestId(`session-row-${account.sessionIds[1]}`)).toHaveCount(0)
    await expect(page.getByTestId("sessions-notice")).toBeVisible()
  })
})

test.describe("страница сессий: зоны, действия и контракт", () => {
  test("показывает классы устройства и браузера и не отдаёт ни IP, ни user-agent", async ({ page }) => {
    const account = await createAccount("t025-classes", desktopAndPhone())
    await useSession(page, account)

    const response = page.waitForResponse(
      (candidate) => candidate.url().includes("/api/graphql") && candidate.request().method() === "POST"
    )
    await page.goto("/me/sessions")
    const payload = await (await response).text()

    // AC-2: ни адреса, ни производного от него места, ни сырого user-agent в ответе API.
    expect(payload).not.toContain("203.0.113.10")
    expect(payload).not.toContain("198.51.100.7")
    expect(payload).not.toContain("Mozilla/5.0")
    for (const field of ["ip", "location", "country", "city", "geo", "userAgent"]) {
      expect(payload).not.toContain(`"${field}"`)
    }

    const current = page.getByTestId(`session-row-${account.sessionIds[0]}`)
    await expect(current).toHaveAttribute("data-session-current", "true")
    await expect(current.getByTestId("session-device")).toContainText("Компьютер")
    await expect(current.getByTestId("session-device")).toContainText("Chrome")
    await expect(current.getByTestId("session-logout")).toBeVisible()

    const other = page.getByTestId(`session-row-${account.sessionIds[1]}`)
    await expect(other).toHaveAttribute("data-session-current", "false")
    await expect(other.getByTestId("session-device")).toContainText("Телефон")
    await expect(other.getByTestId("session-device")).toContainText("Safari")
    await expect(other.getByTestId("session-revoke")).toBeVisible()
  })

  test("«отозвать» закрывает другое устройство в базе, текущее остаётся", async ({ page }) => {
    const account = await createAccount("t025-revoke", desktopAndPhone())
    await useSession(page, account)
    await page.goto("/me/sessions")

    await page.getByTestId(`session-row-${account.sessionIds[1]}`).getByTestId("session-revoke").click()
    await expect(page.getByTestId(`session-row-${account.sessionIds[1]}`)).toHaveCount(0)
    await expect(page.getByTestId("sessions-empty")).toBeVisible()

    expect((await activeSessions(account.email)).map((row) => row.id)).toEqual([account.sessionIds[0]])
  })

  test("«выйти везде» просит подтверждение и оставляет только текущую сессию", async ({ page }) => {
    const account = await createAccount("t025-all", [
      { userAgent: CHROME_DESKTOP, ip: null },
      { userAgent: SAFARI_PHONE, ip: null },
      { userAgent: null, ip: null }
    ])
    await useSession(page, account)
    await page.goto("/me/sessions")

    await page.getByTestId("sessions-logout-all").click()
    await expect(page.getByTestId("confirm-dialog-title")).toBeVisible()
    await page.getByTestId("confirm-dialog-cancel").click()
    expect(await activeSessions(account.email)).toHaveLength(3)

    await page.getByTestId("sessions-logout-all").click()
    await page.getByTestId("confirm-dialog-confirm").click()

    await expect(page.getByTestId("sessions-empty")).toBeVisible()
    await expect(page.getByTestId("sessions-notice")).toContainText("2")
    expect((await activeSessions(account.email)).map((row) => row.id)).toEqual([account.sessionIds[0]])
  })

  test("«выйти» закрывает текущую сессию, стирает cookie и уводит на главную", async ({ page, context }) => {
    const account = await createAccount("t025-logout", desktopAndPhone())
    await useSession(page, account)
    await page.goto("/me/sessions")

    await page.getByTestId(`session-row-${account.sessionIds[0]}`).getByTestId("session-logout").click()
    await page.waitForURL("**/")

    const cookies = await context.cookies()
    expect(
      cookies.find((cookie) => cookie.name === SESSION_ACCESS_COOKIE),
      "access-cookie стёрта"
    ).toBeFalsy()
    expect(cookies.find((cookie) => cookie.name === REFRESH_COOKIE)).toBeFalsy()
    expect((await activeSessions(account.email)).map((row) => row.id)).toEqual([account.sessionIds[1]])

    // Закрытая сессия больше не открывает страницу: возврат уводит на вход.
    await page.goto("/me/sessions")
    await expect(page).toHaveURL(/\/login/)
  })

  test("страница закрыта от индексации (§10)", async ({ page }) => {
    const account = await createAccount("t025-meta", [{ userAgent: CHROME_DESKTOP, ip: null }])
    await useSession(page, account)
    await page.goto("/me/sessions")

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow")
    await expect(page).toHaveTitle(/Сессии и устройства/)
  })
})
