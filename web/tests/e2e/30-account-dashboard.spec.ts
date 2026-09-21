import { expect, test, type Page, type Route } from "@playwright/test"
import { uniqueEmail, withPrisma } from "./helpers/auth-fixtures"
import { createSessionId, signAccessToken } from "./helpers/session-token"
import { SESSION_ACCESS_COOKIE } from "../../shared/session"

/**
 * T-030: сводка кабинета `/me` (`docs/spec/30-account/reader/dashboard.md`).
 * AC-1 — строки состояний §8 воспроизводимы; AC-2 — служебная запись уходит в `/admin`.
 *
 * Вход не проходит по ссылке намеренно: сессия кладётся в базу напрямую, чтобы сценарий не
 * расходовал общую корзину `auth.verify.ip` (`rate-limits.md` §2 п. 3) вместе с T-022.
 */

const HOUR = 3_600_000
const DAY = 24 * HOUR

type Role = "reader" | "author" | "admin"

interface AccountInput {
  role?: Role
  serviceAccount?: boolean
  archived?: boolean
  grants?: { tier: "standard" | "pro"; startsAt: Date; endsAt: Date | null; revokedAt?: Date }[]
}

interface Account {
  id: string
  sessionId: string
}

const createAccount = async (prefix: string, input: AccountInput = {}): Promise<Account> =>
  withPrisma(async (prisma) => {
    const handle = `${prefix}-${Math.random().toString(16).slice(2, 10)}`
    await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(prefix),
        handle,
        name: "Анна Тестова",
        role: input.role ?? "reader",
        isServiceAccount: input.serviceAccount ?? false,
        ...(input.archived ? { archivedAt: new Date(), archiveMode: "self" as const } : {})
      }
    })
    await prisma.handleHistory.update({ where: { handle }, data: { userId: user.id } })

    for (const grant of input.grants ?? []) {
      await prisma.planGrant.create({
        data: { userId: user.id, reason: "t030 e2e", revokedAt: grant.revokedAt ?? null, ...grant }
      })
    }

    return { id: user.id, sessionId: await createSessionId(prisma, user.id) }
  })

interface ArticleInput {
  title: string
  status: "draft" | "review" | "published"
  rejected?: boolean
  unreadDecision?: boolean
  reeditUntil?: Date
}

const createArticles = (account: Account, articles: ArticleInput[]) =>
  withPrisma(async (prisma) => {
    for (const input of articles) {
      const slug = `t030-${Math.random().toString(16).slice(2, 10)}`
      await prisma.article.create({
        data: {
          title: input.title,
          slug,
          body: "",
          status: input.status,
          authorId: account.id,
          translations: {
            create: {
              locale: "ru",
              slug,
              title: input.title,
              body: {},
              status: input.status,
              rejected: input.rejected ?? false,
              publishedAt: input.status === "published" ? new Date() : null,
              reeditUntil: input.reeditUntil ?? null,
              ...(input.unreadDecision
                ? { reviewMessages: { create: { kind: "final_reject" as const, byRole: "moderator" as const } } }
                : {})
            }
          }
        }
      })
    }
  })

const useSession = async (page: Page, account: Account): Promise<void> => {
  await page.context().addCookies([
    {
      name: SESSION_ACCESS_COOKIE,
      value: signAccessToken(account.id, account.sessionId),
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
  JSON.stringify({ data: null, errors: [{ message: code, extensions: { code, requestId: "e2e-t030" } }] })

const stateOf = (page: Page) => page.locator("[data-dashboard-state]")

test.describe("сводка кабинета: строки состояний §8", () => {
  test("«Нет доступа»: гость уходит на вход с путём возврата", async ({ page }) => {
    await page.goto("/me")

    await expect(page).toHaveURL(/\/login\?next=%2Fme$|\/login\?next=\/me$/)
  })

  test("«Заблокирован»: ограниченная сессия уходит на экран состояния", async ({ page }) => {
    const account = await createAccount("t030-archived", { archived: true })
    await useSession(page, account)

    const response = await page.request.get("/me", { maxRedirects: 0 })
    expect(response.status()).toBe(302)
    expect(response.headers().location).toMatch(/\/me\/archived$/)

    await page.goto("/me")
    await expect(page).toHaveURL(/\/me\/archived$/)
  })

  test("«Загрузка» и «Пусто»: первый запуск без статей и закладок", async ({ page }) => {
    const account = await createAccount("t030-empty")
    await useSession(page, account)

    // Чтение закладок задерживается, чтобы «Загрузка» стала наблюдаемой строкой, а не мельканием.
    await stubOperation(page, "GetMyBookmarks", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      await route.fallback()
    })

    await page.goto("/me")
    await expect(page.getByTestId("dashboard-bookmarks-skeleton")).toBeVisible()
    await expect(stateOf(page)).toHaveAttribute("data-dashboard-state", "loading")
    // Карточки аккаунта и плана не ждут подзапросов.
    await expect(page.getByTestId("dashboard-account")).toContainText("Анна Тестова")
    await expect(page.getByTestId("dashboard-initials")).toHaveText("АТ")

    await expect(stateOf(page)).toHaveAttribute("data-dashboard-state", "empty")
    await expect(page.getByTestId("dashboard-plan")).toHaveAttribute("data-plan-state", "free")
    await expect(page.getByTestId("dashboard-plan-headline")).toHaveText("Базовый план, без оплаты")
    await expect(page.getByTestId("dashboard-create-article")).toHaveAttribute("href", "/me/articles/new")
    await expect(page.getByTestId("dashboard-read-invite")).toBeVisible()
    // Без статей авторские разделы скрыты (журнал §8.21), карточки админки нет (§25.2).
    await expect(page.getByTestId("dashboard-attention")).toHaveCount(0)
    await expect(page.getByTestId("dashboard-all-articles")).toHaveCount(0)
    await expect(page.locator('a[href="/admin"]')).toHaveCount(0)
    await expect(page.getByTestId("dashboard-link-sessions")).toHaveAttribute("href", "/me/sessions")
    // E-mail на сводке не показывается (§4).
    await expect(page.locator("body")).not.toContainText("@example")

    await expect(page).toHaveTitle(/Кабинет — Altera/)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow")
  })

  test("«Создать статью» на первом запуске открывает базовое авторство и редактор", async ({ page }) => {
    const account = await createAccount("t030-first-article")
    await useSession(page, account)

    await page.goto("/me")
    await page.getByTestId("dashboard-create-article").click()

    await expect(page).toHaveURL(/\/me\/articles\/[^/]+\/edit$/)
    const grants = await withPrisma((prisma) => prisma.planGrant.findMany({ where: { userId: account.id } }))
    expect(grants).toHaveLength(1)
    expect(grants[0]?.endsAt).toBeNull()
  })

  test("действующий план показывает срок и очередь периодов одной строкой", async ({ page }) => {
    const now = Date.now()
    const account = await createAccount("t030-active", {
      role: "author",
      grants: [
        { tier: "pro", startsAt: new Date(now - DAY), endsAt: new Date(now + 10 * DAY) },
        { tier: "standard", startsAt: new Date(now + 10 * DAY), endsAt: new Date(now + 40 * DAY) }
      ]
    })
    await useSession(page, account)

    await page.goto("/me")

    await expect(page.getByTestId("dashboard-plan")).toHaveAttribute("data-plan-state", "active")
    await expect(page.getByTestId("dashboard-plan-headline")).toContainText(/^Pro до /)
    await expect(page.getByTestId("dashboard-plan-queue")).toContainText(/^Затем: Standard до /)
    await expect(page.getByTestId("dashboard-plan-renew")).toHaveCount(0)
  })

  test("«Ограничение плана»: истёкший план предлагает продлить, писать новое нельзя", async ({ page }) => {
    const now = Date.now()
    const account = await createAccount("t030-expired", {
      grants: [{ tier: "standard", startsAt: new Date(now - 40 * DAY), endsAt: new Date(now - 2 * DAY) }]
    })
    await useSession(page, account)

    await page.goto("/me")

    await expect(stateOf(page)).toHaveAttribute("data-dashboard-state", "plan_limit")
    await expect(page.getByTestId("dashboard-plan")).toHaveAttribute("data-plan-state", "expired")
    await expect(page.getByTestId("dashboard-plan-headline")).toContainText(/^План закончился /)
    await expect(page.getByTestId("dashboard-plan-readonly")).toBeVisible()
    await expect(page.getByTestId("dashboard-plan-renew")).toHaveAttribute("href", "/pricing")
    await expect(page.getByTestId("dashboard-create-article")).toHaveCount(0)
    await expect(page.getByTestId("dashboard-choose-plan")).toBeVisible()
  })

  test("автор видит «Требует внимания» и последние материалы", async ({ page }) => {
    const account = await createAccount("t030-author", {
      role: "author",
      grants: [{ tier: "standard", startsAt: new Date(Date.now() - DAY), endsAt: null }]
    })
    await createArticles(account, [
      { title: "Черновик без внимания", status: "draft" },
      { title: "Материал на проверке", status: "review" },
      { title: "Отклонённый материал", status: "review", rejected: true, unreadDecision: true },
      { title: "Свежая публикация", status: "published", reeditUntil: new Date(Date.now() + 0.5 * HOUR) },
      { title: "Старая публикация", status: "published" }
    ])
    await useSession(page, account)

    await page.goto("/me")

    await expect(stateOf(page)).toHaveAttribute("data-dashboard-state", "ready")
    await expect(page.getByTestId("dashboard-plan")).toHaveAttribute("data-plan-state", "base")
    const attention = page.getByTestId("dashboard-attention")
    await expect(attention.locator("[data-attention-reason]")).toHaveCount(3)
    await expect(attention.locator('[data-attention-reason="checking"]')).toContainText("Материал на проверке")
    await expect(attention.locator('[data-attention-reason="rejected"]')).toContainText("Отклонённый материал")
    await expect(attention.locator('[data-attention-reason="reedit"]')).toContainText(/ещё \d+ мин\./)
    await expect(attention).not.toContainText("Черновик без внимания")

    await expect(page.getByTestId("dashboard-articles").locator("article")).toHaveCount(5)
    await expect(page.getByTestId("dashboard-all-articles")).toHaveAttribute("href", "/me/articles")
    await expect(page.getByTestId("dashboard-write-invite")).toHaveCount(0)
  })

  test("«Ошибка данных» зоны: отказ закладок не роняет остальные карточки", async ({ page }) => {
    const account = await createAccount("t030-zone-error")
    await useSession(page, account)
    await stubOperation(page, "GetMyBookmarks", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: graphQLError("INTERNAL_ERROR") })
    )

    await page.goto("/me")

    await expect(page.getByTestId("dashboard-bookmarks-error")).toBeVisible()
    await expect(stateOf(page)).toHaveAttribute("data-dashboard-state", "zone_error")
    await expect(page.getByTestId("dashboard-plan")).toBeVisible()
    await expect(page.getByTestId("dashboard-create-article")).toBeVisible()
  })

  test("«Ошибка данных»: `me` не ответил — страница 500 с кодом запроса", async ({ page }) => {
    const account = await createAccount("t030-me-error")
    await useSession(page, account)
    await page.goto("/me/sessions")
    await page.waitForLoadState("networkidle")

    await stubOperation(page, "GetAccountDashboard", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: graphQLError("INTERNAL_ERROR") })
    )
    await expect(async () => {
      await page.evaluate(() => {
        window.history.pushState({}, "", "/me")
        window.dispatchEvent(new PopStateEvent("popstate"))
      })
      await expect(page).toHaveURL(/\/me$/, { timeout: 1000 })
    }).toPass()

    await expect(page.getByTestId("server-error")).toContainText("500")
    await expect(page.getByTestId("copy-field-value")).toHaveText("e2e-t030")
  })
})

test.describe("сводка кабинета: служебная запись (журнал §25.2)", () => {
  test("`/me` отвечает 302 на `/admin`", async ({ page }) => {
    const account = await createAccount("t030-staff", { role: "admin", serviceAccount: true })
    await useSession(page, account)

    const response = await page.request.get("/me", { maxRedirects: 0 })
    expect(response.status()).toBe(302)
    expect(response.headers().location).toMatch(/\/admin(\/|$)/)

    await page.goto("/me")
    await expect(page).toHaveURL(/\/admin(\/|$)/)
  })
})
