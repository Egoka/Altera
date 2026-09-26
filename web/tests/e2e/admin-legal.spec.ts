import { expect, test, type Page } from "./helpers/test"
import { PrismaClient } from "../../../server/src/generated/prisma/index.js"
import { createSessionId, signAccessToken } from "./helpers/session-token"

/**
 * T-083: раздел `/admin/legal` (`docs/spec/40-admin/legal-texts.md`).
 * AC-1 — публикация версии делает её действующей на `/legal/*`; AC-2 — строки состояний §9.
 *
 * Оферта и политика ПД участвуют во входе, а русские правила публикации и лицензия — в
 * сценариях T-101, поэтому здесь публикуются только английские правила публикации (их страница
 * `/en/legal/content-rules` больше нигде не проверяется), «О проекте» и черновик условий платных
 * услуг. Номера версий берутся из ответа: база CI общая, повторный прогон добавляет версии.
 */

const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
const roles = ["owner", "admin", "editor"] as const
type TestRole = (typeof roles)[number]

const sessionIds = Object.fromEntries(roles.map((role) => [role, ""])) as Record<TestRole, string>
const token = (role: TestRole) => signAccessToken(`t083-${role}`, sessionIds[role])
const signIn = (page: Page, role: TestRole) => page.setExtraHTTPHeaders({ authorization: `Bearer ${token(role)}` })

const isOperation = (body: unknown, name: string) =>
  typeof body === "object" && body !== null && String(Reflect.get(body, "query")).includes(name)

const marker = () => `t083-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`

/** Черновик через интерфейс владельца: страница вида, форма, переход на карточку черновика. */
const createDraftInUi = async (page: Page, kind: string, locale: string, body: string, summary: string) => {
  await page.goto(`/admin/legal/${kind}?locale=${locale}`)
  await expect(page.locator("[data-legal-draft-form]")).toBeVisible()
  await page.locator("[data-legal-body]").fill(body)
  await page.locator("[data-legal-summary]").fill(summary)
  await page.locator("[data-legal-save]").click()
  await expect(page).toHaveURL(new RegExp(`/admin/legal/${kind}/\\d+\\?locale=${locale}$`))
  await expect(page.locator('[data-legal-detail-status="draft"]')).toBeVisible()
  return Number(new URL(page.url()).pathname.split("/").at(-1))
}

test.describe("admin legal texts", () => {
  test.beforeAll(async () => {
    for (const role of roles) {
      const handle = `t083-${role}`
      await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
      await prisma.user.upsert({
        where: { email: `${handle}@example.test` },
        update: { archivedAt: null, isServiceAccount: true, role },
        create: {
          id: handle,
          email: `${handle}@example.test`,
          handle,
          isServiceAccount: true,
          name: `T083 ${role}`,
          role
        }
      })
      await prisma.handleHistory.update({ where: { handle }, data: { userId: handle } })
      sessionIds[role] = await createSessionId(prisma, handle)
    }
    // Черновик прерванного прошлого прогона не должен подменять текст формы.
    await prisma.legalText.deleteMany({
      where: {
        status: "draft",
        OR: [
          { kind: "content_rules", locale: "en" },
          { kind: "about", locale: "ru" },
          { kind: "paid_services", locale: "ru" }
        ]
      }
    })
  })

  test.afterAll(async () => {
    await prisma.$disconnect()
  })

  test("AC-1: owner публикует черновик, и версия действует на /legal/* с аудитом legal.update", async ({ page }) => {
    const text = marker()
    await signIn(page, "owner")

    const draftVersion = await createDraftInUi(
      page,
      "content_rules",
      "en",
      `<h2 id="rights">Rights</h2><p>${text}</p>`,
      `e2e ${text}`
    )
    await expect(page.locator("[data-legal-preview]")).toContainText(text)

    // Черновик не виден публичной странице.
    const before = await page.request.get("/en/legal/content-rules")
    expect(await before.text()).not.toContain(text)

    await page.locator("[data-legal-publish]").click()
    await expect(page.locator('[data-legal-dialog="options"]')).toContainText(`e2e ${text}`)
    await page.locator("[data-legal-confirm]").click()
    await expect(page.locator('[data-legal-detail-status="published"]')).toBeVisible()

    const published = await prisma.legalText.findFirstOrThrow({
      where: { kind: "content_rules", locale: "en", summaryOfChanges: `e2e ${text}` }
    })
    expect(published).toMatchObject({ status: "published", version: draftVersion, publishedByRole: "owner" })

    await page.goto("/en/legal/content-rules")
    await expect(page.locator("[data-legal-state]")).toHaveAttribute("data-legal-state", "ready")
    await expect(page.getByTestId("legal-body")).toContainText(text)
    await expect(page.getByTestId("legal-fallback")).toHaveCount(0)
    await expect(page.getByTestId("legal-version")).toContainText(String(draftVersion))

    const audit = await prisma.auditLog.findMany({
      where: { action: "legal.update", entityId: published.id },
      orderBy: { createdAt: "asc" }
    })
    expect(audit.map((entry) => (entry.diff as { stage: string }).stage)).toEqual(["draft", "published"])
    expect(audit.every((entry) => entry.actorId === "t083-owner" && entry.actorRole === "owner")).toBe(true)
    expect(JSON.stringify(audit.map((entry) => entry.diff))).not.toContain("<h2")
  })

  test("существенная версия публикуется после второго шага подтверждения", async ({ page }) => {
    const text = marker()
    await signIn(page, "owner")
    await createDraftInUi(page, "about", "ru", `<h2 id="about">О проекте</h2><p>${text}</p>`, `e2e ${text}`)

    await page.locator("[data-legal-publish]").click()
    await page.locator("[data-legal-material]").check()
    await page.locator("[data-legal-confirm]").click()
    await expect(page.locator('[data-legal-dialog="material"]')).toBeVisible()
    await expect(page.locator("[data-legal-affected]")).toContainText("согласие не запрашивается")
    expect(await prisma.legalText.count({ where: { summaryOfChanges: `e2e ${text}`, status: "published" } })).toBe(0)

    await page.locator("[data-legal-confirm]").click()
    await expect(page.locator('[data-legal-detail-status="published"]')).toBeVisible()
    await expect(
      prisma.legalText.findFirstOrThrow({ where: { summaryOfChanges: `e2e ${text}` } })
    ).resolves.toMatchObject({ status: "published", isMaterial: true })
  })

  test("«Нет прав на часть действий»: admin читает и сравнивает, публикует владелец", async ({ page }) => {
    await signIn(page, "admin")
    const response = await page.goto("/admin/legal?kind=content_rules&locale=en")

    expect(response?.status()).toBe(200)
    await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", "noindex,nofollow")
    await expect(page.locator("[data-legal-permission]")).toHaveText("Чтение и предпросмотр. Публикует владелец.")
    await expect(page.locator('[data-legal-kind="content_rules"] [data-legal-current]')).toBeVisible()
    await expect(page.locator('[data-legal-status="published"]').first()).toBeVisible()

    await page.goto("/admin/legal/content_rules?locale=en")
    await expect(page.locator("[data-legal-kind-versions]")).toBeVisible()
    await expect(page.locator("[data-legal-draft-form]")).toHaveCount(0)

    await page.locator('[data-legal-status="published"] a').first().click()
    await expect(page.locator('[data-legal-detail-status="published"]')).toBeVisible()
    await expect(page.locator("[data-legal-preview]")).toBeVisible()
    await expect(page.locator("[data-legal-publish]")).toHaveCount(0)
    await page.locator('[data-legal-tab="compare"]').click()
    await expect(page.locator("[data-legal-compare-none]")).toBeVisible()

    const mutation = await page.request.post("/api/graphql", {
      headers: { authorization: `Bearer ${token("admin")}` },
      data: {
        query: "mutation($input: CreateLegalDraftInput!) { createLegalDraft(input: $input) { id } }",
        variables: { input: { kind: "about", locale: "en", body: "<p>x</p>", summaryOfChanges: "x" } }
      }
    })
    const body = await mutation.json()
    expect(body.errors[0].extensions).toMatchObject({ code: "FORBIDDEN", action: "legal.update" })
  })

  test("«Пусто»: вид без версий — «текст ещё не опубликован»", async ({ page }) => {
    await signIn(page, "admin")
    await page.goto("/admin/legal?locale=en")
    await expect(page.locator('[data-legal-kind="refunds"] [data-legal-empty]')).toHaveText("Текст ещё не опубликован.")
  })

  test("«Загрузка»: скелет, пока идёт запрос", async ({ page }) => {
    await signIn(page, "admin")
    await page.goto("/admin/legal")
    await expect(page.locator("[data-legal-kinds]")).toBeVisible()
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route("**/api/graphql", async (route) => {
      if (!isOperation(route.request().postDataJSON(), "GetAdminLegalKinds")) return route.continue()
      await gate
      await route.continue()
    })

    await page.locator('[data-legal-filter="status"]').selectOption("published")

    await expect(page.locator("[data-legal-loading]")).toBeVisible()
    release()
    await expect(page.locator("[data-legal-kinds]")).toBeVisible()
    await expect(page).toHaveURL((url) => url.searchParams.get("status") === "published")
  })

  test("«Ошибка»: requestId и повтор", async ({ page }) => {
    await signIn(page, "admin")
    let fail = true
    await page.route("**/api/graphql", async (route) => {
      if (!fail || !isOperation(route.request().postDataJSON(), "GetAdminLegalKinds")) return route.continue()
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: null,
          errors: [{ message: "Internal server error", extensions: { code: "INTERNAL_ERROR", requestId: "req-t083" } }]
        })
      })
    })

    await page.goto("/admin/legal")

    await expect(page.locator("[data-legal-error]")).toContainText("req-t083")
    fail = false
    await page.locator("[data-legal-error] button").click()
    await expect(page.locator("[data-legal-error]")).toHaveCount(0)
    await expect(page.locator("[data-legal-kinds]")).toBeVisible()
  })

  test("«Конфликт»: черновик изменил другой owner — CONFLICT и обновление", async ({ page }) => {
    const text = marker()
    await signIn(page, "owner")
    const version = await createDraftInUi(page, "paid_services", "ru", `<p>${text}</p>`, `e2e ${text}`)
    await page.goto(`/admin/legal/paid_services?locale=ru`)
    await expect(page.locator("[data-legal-paid-notice]")).toContainText("пока не предоставляются")

    await page.goto(`/admin/legal/paid_services/${version}?locale=ru`)
    await expect(page.locator('[data-legal-detail-status="draft"]')).toBeVisible()
    // Другой владелец сохраняет черновик, пока открыта карточка.
    await prisma.legalText.update({
      where: { kind_locale_version: { kind: "paid_services", locale: "ru", version } },
      data: { summaryOfChanges: `e2e ${text} (другой владелец)` }
    })

    await page.locator("[data-legal-publish]").click()
    await page.locator("[data-legal-confirm]").click()

    await expect(page.locator("[data-legal-publish-error]")).toHaveAttribute("data-legal-failure", "CONFLICT")
    await page.locator("[data-legal-publish-error] button").click()
    await expect(page.locator("[data-legal-detail-summary]")).toHaveText(`e2e ${text} (другой владелец)`)
    await expect(
      prisma.legalText.findFirstOrThrow({ where: { kind: "paid_services", locale: "ru", version } })
    ).resolves.toMatchObject({ status: "draft" })
  })

  test("editor получает 403", async ({ page }) => {
    await signIn(page, "editor")
    expect((await page.goto("/admin/legal"))?.status()).toBe(403)
    await expect(page.locator("[data-legal-kinds]")).toHaveCount(0)
  })

  test("гость переходит на вход с исходным адресом", async ({ page }) => {
    await page.goto("/admin/legal?locale=en")
    await expect(page).toHaveURL(
      (url) => url.pathname === "/login" && url.searchParams.get("next") === "/admin/legal?locale=en"
    )
  })
})
