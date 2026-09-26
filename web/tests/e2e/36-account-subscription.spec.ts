import { expect, test, type Page, type Route } from "./helpers/test"
import { uniqueEmail, withPrisma } from "./helpers/auth-fixtures"
import { createSessionId, signAccessToken } from "./helpers/session-token"
import { SESSION_ACCESS_COOKIE } from "../../shared/session"
import type { PrismaClient } from "../../../server/src/generated/prisma/index.js"
import { navigateOnClient } from "./helpers/hydration"

/**
 * T-036: подписка `/me/subscription` в режиме первого запуска
 * (`docs/spec/30-account/reader/subscription.md`, `checkout.md` §3; журнал §24.1).
 * AC-1 — `/me/subscription/checkout` отвечает 404; AC-2 — строки состояний §8 для первого
 * запуска воспроизводимы. Платёжные мутации до включения платности отвечают `FORBIDDEN`.
 *
 * Сессия кладётся в базу напрямую, как в T-030: вход по ссылке расходовал бы общую корзину
 * `auth.verify.ip` (`rate-limits.md` §2 п. 3).
 */

const DAY = 24 * 3_600_000

type Role = "reader" | "author" | "admin"

interface AccountInput {
  role?: Role
  serviceAccount?: boolean
  archived?: boolean
  grants?: { tier: "standard" | "pro"; startsAt: Date; endsAt: Date | null }[]
}

interface Account {
  id: string
  sessionId: string
}

const grantingAdmin = async (prisma: PrismaClient): Promise<string> => {
  const handle = "t036-granting-admin"
  await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
  const admin = await prisma.user.upsert({
    where: { email: `${handle}@example.test` },
    update: { archivedAt: null, isServiceAccount: true, role: "admin" },
    create: { email: `${handle}@example.test`, handle, name: "T036 admin", role: "admin", isServiceAccount: true }
  })
  await prisma.handleHistory.update({ where: { handle }, data: { userId: admin.id } })
  return admin.id
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

    // Выдача со сроком обязана иметь выдавшего сотрудника (`plan_grants_source_check`).
    const timed = (input.grants ?? []).some((grant) => grant.endsAt !== null)
    const grantedById = timed ? await grantingAdmin(prisma) : null
    for (const grant of input.grants ?? []) {
      await prisma.planGrant.create({
        data: { userId: user.id, reason: "t036 e2e", grantedById: grant.endsAt === null ? null : grantedById, ...grant }
      })
    }

    return { id: user.id, sessionId: await createSessionId(prisma, user.id) }
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

/** Подменяет ответ одной операции: «Загрузка» и «Ошибка данных» иначе не снять. */
const stubOperation = (page: Page, operation: string, handle: (route: Route) => Promise<void>) =>
  page.route("**/api/graphql", async (route) => {
    const body = route.request().postDataJSON() as { query?: string } | null
    if (typeof body?.query === "string" && body.query.includes(operation)) {
      await handle(route)
      return
    }
    await route.fallback()
  })

/** Клиентский переход на страницу подписки со страницы сессий — ленивая загрузка §8. */
const openSubscriptionOnClient = (page: Page) => navigateOnClient(page, "/me/subscription")

const stateOf = (page: Page) => page.locator("[data-subscription-state]")

const PAYMENT_MUTATIONS = [
  "mutation { startCheckout(tier: pro, interval: month) }",
  "mutation { cancelSubscription }",
  "mutation { resumeSubscription }",
  'mutation { requestRefund(paymentId: "t036-payment", reason: "план не подошёл") }',
  "mutation { confirmPriceChange(decision: confirm) }"
]

test.describe("маршруты оплаты до включения платности", () => {
  test("`/me/subscription/checkout` и `/result` отвечают 404 гостю и вошедшему", async ({ page }) => {
    const paths = [
      "/me/subscription/checkout",
      "/me/subscription/checkout?plan=pro&interval=year",
      "/me/subscription/result?payment=t036-payment"
    ]
    for (const path of paths) {
      expect((await page.request.get(path, { maxRedirects: 0 })).status(), `гость ${path}`).toBe(404)
    }

    await useSession(page, await createAccount("t036-checkout"))
    for (const path of paths) {
      expect((await page.request.get(path, { maxRedirects: 0 })).status(), `вошедший ${path}`).toBe(404)
    }
  })

  test("платёжные мутации отвечают FORBIDDEN, гостю — UNAUTHENTICATED", async ({ page }) => {
    await page.goto("/")
    const codes = () =>
      page.evaluate(async (queries) => {
        const result: unknown[] = []
        for (const query of queries) {
          const response = await fetch("/api/graphql", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ query })
          })
          const body = (await response.json()) as { errors?: { extensions?: { code?: string } }[] }
          result.push(body.errors?.[0]?.extensions?.code ?? null)
        }
        return result
      }, PAYMENT_MUTATIONS)

    expect(await codes()).toEqual(PAYMENT_MUTATIONS.map(() => "UNAUTHENTICATED"))

    await useSession(page, await createAccount("t036-mutations", { role: "author" }))
    expect(await codes()).toEqual(PAYMENT_MUTATIONS.map(() => "FORBIDDEN"))
  })

  test("старые адреса `/me/billing` и `/me/plan` ведут на подписку (301)", async ({ page }) => {
    for (const path of ["/me/billing", "/me/plan"]) {
      const response = await page.request.get(path, { maxRedirects: 0 })
      expect(response.status(), path).toBe(301)
      expect(response.headers().location, path).toMatch(/\/me\/subscription$/)
    }
  })
})

test.describe("подписка: строки состояний §8 на первом запуске", () => {
  test("«Нет доступа»: гость уходит на вход с путём возврата", async ({ page }) => {
    await page.goto("/me/subscription")

    await expect(page).toHaveURL(/\/login\?next=(%2Fme%2Fsubscription|\/me\/subscription)$/)
  })

  test("«Заблокирован»: ограниченная сессия уходит на экран состояния", async ({ page }) => {
    await useSession(page, await createAccount("t036-archived", { archived: true }))

    const response = await page.request.get("/me/subscription", { maxRedirects: 0 })
    expect(response.status()).toBe(302)
    expect(response.headers().location).toMatch(/\/me\/archived$/)
  })

  test("базовый план без оплаты: «платные планы появятся позже», платежей и оплаты нет", async ({ page }) => {
    await useSession(
      page,
      await createAccount("t036-base", {
        grants: [{ tier: "standard", startsAt: new Date(Date.now() - DAY), endsAt: null }]
      })
    )

    const response = await page.request.get("/me/subscription", { maxRedirects: 0 })
    expect(response.status()).toBe(200)
    expect(response.headers()["cache-control"]).toBe("private, no-store")

    await page.goto("/me/subscription")
    await expect(stateOf(page)).toHaveAttribute("data-subscription-state", "ready")
    await expect(page.getByTestId("subscription-plan")).toHaveAttribute("data-plan-view", "base")
    await expect(page.getByTestId("subscription-plan-headline")).toHaveText("Базовый план, без оплаты")
    await expect(page.getByTestId("subscription-plan-later")).toHaveText("Платные планы появятся позже.")
    await expect(page.getByTestId("subscription-payments")).toContainText("Платежей нет.")
    await expect(page.getByTestId("subscription-queue")).toHaveCount(0)
    await expect(page.locator('a[href^="/me/subscription/checkout"]')).toHaveCount(0)
    await expect(page.getByTestId("subscription-help-pricing")).toHaveAttribute("href", "/pricing")

    await expect(page).toHaveTitle(/Подписка — Altera/)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow")
  })

  test("действующая выдача показывает срок, источник и очередь периодов", async ({ page }) => {
    const now = Date.now()
    await useSession(
      page,
      await createAccount("t036-active", {
        role: "author",
        grants: [
          { tier: "pro", startsAt: new Date(now - DAY), endsAt: new Date(now + 10 * DAY) },
          { tier: "standard", startsAt: new Date(now + 10 * DAY), endsAt: new Date(now + 40 * DAY) }
        ]
      })
    )

    await page.goto("/me/subscription")

    await expect(page.getByTestId("subscription-plan")).toHaveAttribute("data-plan-view", "active")
    await expect(page.getByTestId("subscription-plan-headline")).toContainText(/^Pro до /)
    await expect(page.getByTestId("subscription-plan-source")).toHaveText("Выдан редакцией, без оплаты")
    await expect(page.locator("#queue li")).toHaveCount(1)
    await expect(page.locator("#queue li")).toContainText(/^Standard: с .+ до /)
  })

  test("«Ограничение плана»: истёкшая выдача — только чтение и «продлить» через планы", async ({ page }) => {
    const now = Date.now()
    await useSession(
      page,
      await createAccount("t036-expired", {
        grants: [{ tier: "standard", startsAt: new Date(now - 40 * DAY), endsAt: new Date(now - 2 * DAY) }]
      })
    )

    await page.goto("/me/subscription")

    await expect(stateOf(page)).toHaveAttribute("data-subscription-state", "plan_limit")
    await expect(page.getByTestId("subscription-plan-headline")).toContainText(/^План закончился /)
    await expect(page.getByTestId("subscription-plan-readonly")).toBeVisible()
    await expect(page.getByTestId("subscription-plan-renew")).toHaveAttribute("href", "/pricing")
    await expect(page.getByTestId("subscription-payments")).toContainText("Платежей нет.")
  })

  test("служебная запись видит пояснение §8.17 и ссылку в «Подписки» админки", async ({ page }) => {
    await useSession(page, await createAccount("t036-staff", { role: "admin", serviceAccount: true }))

    await page.goto("/me/subscription")

    await expect(stateOf(page)).toHaveAttribute("data-subscription-state", "service")
    await expect(page.getByTestId("subscription-service")).toContainText(
      "Служебные учётные записи планы не приобретают."
    )
    await expect(page.getByTestId("subscription-service-admin")).toHaveAttribute("href", "/admin/subscriptions")
  })

  test("«Загрузка» при клиентском переходе показывает скелет", async ({ page }) => {
    await useSession(page, await createAccount("t036-loading"))
    await page.goto("/me/sessions")
    await page.waitForLoadState("networkidle")
    await stubOperation(page, "GetAccountSubscription", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      await route.fallback()
    })

    await openSubscriptionOnClient(page)

    await expect(page.getByTestId("subscription-skeleton")).toBeVisible()
    await expect(stateOf(page)).toHaveAttribute("data-subscription-state", "loading")
    await expect(stateOf(page)).toHaveAttribute("data-subscription-state", "ready")
  })

  test("«Ошибка данных»: код запроса и повтор", async ({ page }) => {
    await useSession(page, await createAccount("t036-error"))
    await page.goto("/me/sessions")
    await page.waitForLoadState("networkidle")
    let failing = true
    await stubOperation(page, "GetAccountSubscription", async (route) => {
      if (!failing) return route.fallback()
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: null,
          errors: [{ message: "INTERNAL_ERROR", extensions: { code: "INTERNAL_ERROR", requestId: "e2e-t036" } }]
        })
      })
    })

    await openSubscriptionOnClient(page)

    await expect(stateOf(page)).toHaveAttribute("data-subscription-state", "data_error")
    await expect(page.getByTestId("subscription-error")).toContainText("e2e-t036")

    failing = false
    await page.getByTestId("subscription-error").getByRole("button").click()
    await expect(stateOf(page)).toHaveAttribute("data-subscription-state", "ready")
  })
})
