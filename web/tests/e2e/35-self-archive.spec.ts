import { randomBytes } from "node:crypto"
import { expect, test, type APIRequestContext, type Page, type Route } from "./helpers/test"
import { uniqueEmail, withPrisma } from "./helpers/auth-fixtures"
import { signAccessToken } from "./helpers/session-token"
import { SESSION_ACCESS_COOKIE } from "../../shared/session"

/**
 * T-035: «удалить аккаунт» = самостоятельное архивирование и экран состояния
 * (`docs/spec/30-account/reader/delete-account.md`, `archived-state.md`, flow #12 шаги 2–5).
 *
 * AC-1 проверяется на живой базе и живой почте: после восстановления аккаунта статьи остаются
 * в архиве. AC-2 — строки состояний обеих страниц; те из них, что зависят от отказа сервера
 * (лимит «1 письмо в сутки», последний владелец, недействительная ссылка), снимаются
 * подстановкой ответа: исчерпать настоящую суточную корзину сценарий не может.
 *
 * Вход здесь не проходит по ссылке намеренно: сессия кладётся в базу напрямую, чтобы сценарий
 * не расходовал общую корзину `auth.verify.ip` (`rate-limits.md` §2 п. 3).
 */

const mailpitUrl = process.env.T021_MAILPIT_URL ?? "http://127.0.0.1:28025"

interface Account {
  id: string
  email: string
  sessionId: string
}

const createAccount = async (prefix: string, options: { limited?: boolean } = {}): Promise<Account> =>
  withPrisma(async (prisma) => {
    const handle = `${prefix}-${Math.random().toString(16).slice(2, 10)}`
    await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
    const user = await prisma.user.create({
      data: { email: uniqueEmail(prefix), handle, name: "T035 account", role: "author" }
    })
    await prisma.handleHistory.update({ where: { handle }, data: { userId: user.id } })

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: randomBytes(32).toString("hex"),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        limited: options.limited ?? false
      }
    })

    return { id: user.id, email: user.email, sessionId: session.id }
  })

const createArticle = (account: Account, status: "published" | "draft") =>
  withPrisma(async (prisma) => {
    const article = await prisma.article.create({
      data: {
        title: `T035 ${status}`,
        slug: `t035-${Math.random().toString(16).slice(2, 10)}`,
        body: "",
        status,
        publishedAt: status === "published" ? new Date() : null,
        firstPublishedAt: status === "published" ? new Date() : null,
        authorId: account.id
      }
    })
    return article.id
  })

const archiveAccount = (account: Account) =>
  withPrisma((prisma) =>
    prisma.user.update({
      where: { id: account.id },
      data: { archivedAt: new Date(), archiveMode: "self", archivedByActorId: account.id, archiveReason: "self" }
    })
  )

const useSession = async (page: Page, account: Account): Promise<void> => {
  await page.context().clearCookies()
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

/** Одноразовая ссылка подтверждения приходит только письмом: экран её не показывает. */
const readArchiveLink = async (request: APIRequestContext, email: string): Promise<string> => {
  const deadline = Date.now() + 20_000

  for (;;) {
    const search = await request.get(`${mailpitUrl}/api/v1/search`, { params: { query: `to:"${email}"` } })
    const messages = ((await search.json()) as { messages: { ID: string }[] }).messages

    for (const message of messages) {
      const delivered = (await (await request.get(`${mailpitUrl}/api/v1/message/${message.ID}`)).json()) as {
        Text: string
      }
      const token = delivered.Text.match(/\/me\/delete\/confirm\?token=([0-9a-f]{64})/)?.[1]
      if (token) return `/me/delete/confirm?token=${token}`
    }

    if (Date.now() > deadline) throw new Error(`No archive confirmation letter delivered to ${email}`)
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

/** Подменяет ответ одной операции: строки §8, зависящие от отказа сервера, иначе не снять. */
const stubOperation = (page: Page, operation: string, handle: (route: Route) => Promise<void>) =>
  page.route("**/api/graphql", async (route) => {
    const body = route.request().postDataJSON() as { query?: string } | null
    if (typeof body?.query === "string" && body.query.includes(operation)) {
      await handle(route)
      return
    }
    await route.continue()
  })

const failWith = (extensions: Record<string, unknown>) => async (route: Route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: null, errors: [{ extensions }] })
  })

test("flow #12 шаги 2–5: письмо архивирует аккаунт, восстановление возвращает только его", async ({
  page,
  request
}) => {
  const account = await createAccount("t035-flow")
  const publishedId = await createArticle(account, "published")
  const draftId = await createArticle(account, "draft")
  await useSession(page, account)

  await test.step("Шаг 2: последствия на экране и письмо для подтверждения", async () => {
    await page.goto("/me/delete")
    await expect(page.locator("[data-delete-account-state='ready']")).toBeVisible()
    await expect(page.getByTestId("delete-account-consequences")).toBeVisible()
    await expect(page.getByTestId("delete-account-articles")).toContainText("2")
    // Единственный вариант судьбы материалов — архив всех (журнал #4).
    await expect(page.locator("[data-testid='delete-account-fate'] input")).toHaveCount(1)

    await page.getByTestId("delete-account-send").click()
    await expect(page.getByTestId("delete-account-pending")).toBeVisible()
    await expect(page.getByTestId("delete-account-cancel")).toBeVisible()
  })

  const confirmPath = await readArchiveLink(request, account.email)

  await test.step("Шаг 3: подтверждение архивирует аккаунт, статьи и отзывает сессии", async () => {
    await page.goto(confirmPath)
    await expect(page.locator("[data-confirm-archive-state='form']")).toBeVisible()

    // Ввод слова — условие подтверждения (§5): до него кнопка недоступна.
    await expect(page.getByTestId("confirm-archive-submit")).toBeDisabled()
    await page.getByTestId("confirm-archive-word").fill("удалить")
    await page.getByTestId("confirm-archive-submit").click()
    await expect(page.getByTestId("confirm-archive-done")).toBeVisible()

    const archived = await withPrisma((prisma) => prisma.user.findUnique({ where: { id: account.id } }))
    expect(archived!.archivedAt).not.toBeNull()
    expect(archived!.archiveMode).toBe("self")

    const articles = await withPrisma((prisma) => prisma.article.findMany({ where: { authorId: account.id } }))
    expect(articles.map((article) => article.status)).toEqual(["archived", "archived"])
    // Актор каскада — сам автор: иначе вернуть статьи после восстановления он не сможет.
    expect(articles.every((article) => article.archivedByActorId === account.id)).toBe(true)

    const sessions = await withPrisma((prisma) => prisma.session.findMany({ where: { userId: account.id } }))
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true)

    const audit = await withPrisma((prisma) =>
      prisma.auditLog.findMany({ where: { entityId: account.id, action: "user.archive.self" } })
    )
    expect(audit).toHaveLength(1)
    expect(audit[0]!.diff).toMatchObject({ mode: "self", articlesArchived: 2 })

    // Cookie стёрты маршрутом BFF вместе с отзывом сессий: кабинет уводит на вход.
    await page.goto("/me")
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
  })

  await test.step("Шаг 4: вход в архивированный аккаунт открывает только экран состояния", async () => {
    const limited = await withPrisma(async (prisma) => {
      const session = await prisma.session.create({
        data: {
          userId: account.id,
          tokenHash: randomBytes(32).toString("hex"),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          limited: true
        }
      })
      return { ...account, sessionId: session.id }
    })
    await useSession(page, limited)

    await page.goto("/me/archived")
    await expect(page.locator("[data-archived-state='ready']")).toBeVisible()
    await expect(page.getByTestId("archived-articles")).toContainText("2")

    // Любой другой раздел кабинета отвечает `FORBIDDEN` и возвращает сюда (п. 7 жизненного цикла).
    await page.goto("/me")
    await expect(page).toHaveURL(/\/me\/archived$/)
  })

  await test.step("Шаг 5: AC-1 — восстановление возвращает аккаунт, статьи остаются в архиве", async () => {
    await page.goto("/me/archived")
    await page.getByTestId("archived-restore").click()
    await page.getByTestId("confirm-dialog-confirm").click()
    await expect(page).toHaveURL(/\/me(?:\?|$)/)

    const restored = await withPrisma((prisma) => prisma.user.findUnique({ where: { id: account.id } }))
    expect(restored!.archivedAt).toBeNull()
    expect(restored!.archiveMode).toBeNull()

    const articles = await withPrisma((prisma) =>
      prisma.article.findMany({ where: { id: { in: [publishedId, draftId] } } })
    )
    expect(articles.map((article) => article.status)).toEqual(["archived", "archived"])

    const audit = await withPrisma((prisma) =>
      prisma.auditLog.findMany({ where: { entityId: account.id, action: "user.restore.self" } })
    )
    expect(audit).toHaveLength(1)
  })
})

test("строки состояний §8 страницы «Удалить аккаунт»", async ({ page }) => {
  const account = await createAccount("t035-states")
  await useSession(page, account)

  await test.step("Нет доступа: гость уводится на вход с путём возврата", async () => {
    await page.context().clearCookies()
    await page.goto("/me/delete")
    await expect(page).toHaveURL(/\/login\?next=\/me\/delete$/)
  })

  await useSession(page, account)

  await test.step("Ошибка данных: предпросмотр не получен", async () => {
    await stubOperation(page, "query GetAccountArchivePreview", failWith({ code: "INTERNAL_ERROR", requestId: "req" }))
    await page.goto("/me/delete")
    await expect(page.locator("[data-delete-account-state='data_error']")).toBeVisible()
    await expect(page.getByTestId("delete-account-retry")).toBeVisible()
    await page.unroute("**/api/graphql")
  })

  await test.step("Ограничение: лимит одного письма в сутки называет время следующей попытки", async () => {
    await stubOperation(page, "mutation RequestAccountArchive", failWith({ code: "RATE_LIMITED", retryAfter: 3600 }))
    await page.goto("/me/delete")
    await page.getByTestId("delete-account-send").click()
    await expect(page.getByTestId("delete-account-error")).toContainText("60")
    await page.unroute("**/api/graphql")
  })

  await test.step("Заблокирован: последний владелец сначала назначает другого", async () => {
    await page.route("**/api/graphql", async (route) => {
      const body = route.request().postDataJSON() as { query?: string } | null
      if (typeof body?.query === "string" && body.query.includes("query GetAccountArchivePreview")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              me: {
                id: account.id,
                role: "owner",
                archivePreview: { articlesCount: 0, isLastOwner: true, plan: null, pending: null }
              }
            }
          })
        })
        return
      }
      await route.continue()
    })
    await page.goto("/me/delete")
    await expect(page.getByTestId("delete-account-last-owner")).toBeVisible()
    await expect(page.getByTestId("delete-account-send")).toHaveCount(0)
    await page.unroute("**/api/graphql")
  })
})

test("строки состояний §8 экрана состояния и страницы подтверждения", async ({ page }) => {
  const account = await createAccount("t035-archived", { limited: true })

  await test.step("Не найдено: истёкшая ссылка предлагает запросить письмо заново", async () => {
    await useSession(page, account)
    await stubOperation(
      page,
      "mutation ConfirmAccountArchive",
      failWith({ code: "NOT_FOUND", entity: "accountArchive" })
    )
    await page.goto(`/me/delete/confirm?token=${"f".repeat(64)}`)
    await page.getByTestId("confirm-archive-word").fill("удалить")
    await page.getByTestId("confirm-archive-submit").click()
    await expect(page.getByTestId("confirm-archive-invalid")).toBeVisible()
    await page.unroute("**/api/graphql")
  })

  await test.step("Нет доступа: обычная сессия на экране состояния уходит в кабинет", async () => {
    await page.goto("/me/archived")
    await expect(page).toHaveURL(/\/me$/)
  })

  await archiveAccount(account)

  await test.step("Ошибка данных: состояние не получено, выход остаётся доступен", async () => {
    await stubOperation(page, "query GetAccountArchiveState", failWith({ code: "INTERNAL_ERROR", requestId: "req" }))
    await page.goto("/me/archived")
    await expect(page.getByTestId("archived-data-error")).toBeVisible()
    await expect(page.getByTestId("archived-logout")).toBeVisible()
    await page.unroute("**/api/graphql")
  })

  await test.step("Не найдено: аккаунт уже восстановлен в другой вкладке", async () => {
    await stubOperation(page, "mutation RestoreAccountSelf", failWith({ code: "CONFLICT", entity: "user" }))
    await page.goto("/me/archived")
    await page.getByTestId("archived-restore").click()
    await page.getByTestId("confirm-dialog-confirm").click()
    await expect(page.getByTestId("archived-error")).toBeVisible()
    await page.unroute("**/api/graphql")
  })

  await test.step("Заблокирован: административный архив восстановить отсюда нельзя", async () => {
    await withPrisma((prisma) => prisma.user.update({ where: { id: account.id }, data: { archiveMode: "admin" } }))
    await page.goto("/me/archived")
    // Экран состояния — только для самостоятельного архива (матрица #116): остальным здесь
    // остаётся обращение в редакцию, а не кнопка восстановления.
    await expect(page.getByTestId("archived-blocked")).toBeVisible()
    await expect(page.getByTestId("archived-restore")).toHaveCount(0)
  })
})
