import { expect, test, type Page } from "./helpers/test"
import { PrismaClient, type Role } from "../../../server/src/generated/prisma/index.js"
import { createSessionId, signAccessToken } from "./helpers/session-token"

// T-080: раздел `/admin/mail` — все строки состояний docs/spec/40-admin/mail.md §9,
// разделение ролей §1 и отсутствие секретов в копии письма §3.
// T-134: в списке адрес идёт маской и содержания нет — полный адрес открывает только карточка
// с записью аудита (журнал §28.7).
const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const prisma = new PrismaClient({ datasourceUrl: databaseUrl })

const template = "t080_notice"
const recipient = "t080-recipient@example.test"
const maskedRecipient = "t***t@example.test"
const roles = ["editor", "moderator", "analyst", "admin", "owner", "author"] as const
type TestRole = (typeof roles)[number]

const userIds = Object.fromEntries(roles.map((role) => [role, `t080-${role}`])) as Record<TestRole, string>

// После T-023 токен авторизует запрос только вместе с живой сессией (ADR-0009 п. 3).
const sessionIds = Object.fromEntries(roles.map((role) => [role, ""])) as Record<TestRole, string>

const signToken = (role: TestRole) => signAccessToken(userIds[role], sessionIds[role])

async function upsertUser(role: TestRole) {
  const id = userIds[role]
  const handle = `t080-${role}`
  await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
  await prisma.user.upsert({
    where: { email: `${handle}@example.test` },
    update: { archivedAt: null, isServiceAccount: role !== "author", role: role as Role },
    create: {
      id,
      email: `${handle}@example.test`,
      handle,
      isServiceAccount: role !== "author",
      name: `T080 ${role}`,
      role: role as Role
    }
  })
  await prisma.handleHistory.update({ where: { handle }, data: { userId: id } })
  sessionIds[role] = await createSessionId(prisma, id)
}

async function seedMail() {
  await prisma.article.upsert({
    where: { slug: "t080-article" },
    update: { isEditorial: true, status: "review" },
    create: {
      id: "t080-article",
      authorId: userIds.author,
      body: "T080 fixture",
      isEditorial: true,
      slug: "t080-article",
      status: "review",
      title: "T080 article"
    }
  })

  const mails = [
    {
      id: "t080-mail-failed",
      status: "failed" as const,
      subject: "T080 письмо с ошибкой",
      deliveryErrorClass: "SMTPConnectionError",
      objectType: "Article",
      objectId: "t080-article"
    },
    {
      id: "t080-mail-sent",
      status: "sent" as const,
      subject: "T080 доставленное письмо",
      deliveryErrorClass: null,
      objectType: "Article",
      objectId: "t080-article"
    },
    {
      id: "t080-mail-queued",
      status: "queued" as const,
      subject: "T080 письмо в очереди",
      deliveryErrorClass: null,
      objectType: null,
      objectId: null
    }
  ]

  for (const mail of mails) {
    const data = {
      ...mail,
      template,
      recipientEmail: recipient,
      sanitizedBody: "T080 содержание без секретов.",
      provider: "smtp",
      createdAt: new Date(),
      queuedAt: new Date()
    }
    await prisma.mailMessage.upsert({ where: { id: mail.id }, update: data, create: data })
  }

  // Письмо входа: копия хранится без токена и повторной отправке не подлежит (§3, §5).
  const secret = {
    id: "t080-mail-secret",
    template: "magic_link",
    recipientEmail: recipient,
    subject: "Ссылка входа в Altera",
    sanitizedBody: "Войти в Altera: [секрет не показывается]",
    status: "failed" as const,
    provider: "smtp",
    createdAt: new Date(),
    queuedAt: new Date()
  }
  await prisma.mailMessage.upsert({ where: { id: secret.id }, update: secret, create: secret })

  // Код смены почты — тоже секрет: копия несёт пометку, повтор запрещён (T-134 §3).
  const code = {
    id: "t080-mail-code",
    template: "email_change_code",
    recipientEmail: recipient,
    subject: "Код смены почты в Altera",
    sanitizedBody: "Код: [секрет не показывается]",
    status: "failed" as const,
    provider: "smtp",
    createdAt: new Date(),
    queuedAt: new Date()
  }
  await prisma.mailMessage.upsert({ where: { id: code.id }, update: code, create: code })
}

const authorize = (page: Page, role: TestRole) =>
  page.setExtraHTTPHeaders({ authorization: `Bearer ${signToken(role)}` })

const isOperation = (body: { query?: string } | null, name: string) => body?.query?.includes(name) === true

test.describe("admin mail", () => {
  test.describe.configure({ mode: "serial" })

  test.beforeAll(async () => {
    for (const role of roles) await upsertUser(role)
    await seedMail()
  })

  test.afterAll(async () => {
    await prisma.$disconnect()
  })

  test("owner sees the masked address in the list and the full one with the stored copy on the card", async ({
    page
  }) => {
    await authorize(page, "owner")

    await page.goto(`/admin/mail?template=${template}`)

    await expect(page.locator('[data-mail-row="t080-mail-failed"]')).toBeVisible()
    await expect(page.locator('[data-mail-row="t080-mail-failed"] [data-mail-recipient]')).toHaveText(maskedRecipient)
    await expect(page.locator("[data-mail-masked-note]")).toBeVisible()
    await expect(page.locator("[data-mail-table]")).not.toContainText("T080 содержание без секретов.")
    await expect(page.locator("[data-mail-bulk-resend]")).toBeVisible()

    await page.goto("/admin/mail/t080-mail-failed")

    await expect(page.locator("[data-mail-recipient]")).toHaveText(recipient)
    await expect(page.locator("[data-mail-body]")).toContainText("T080 содержание без секретов.")
    await expect(page.locator("[data-mail-resend]")).toBeVisible()
  })

  test("the stored copy of an e-mail change code keeps no code and cannot be repeated", async ({ page }) => {
    await authorize(page, "owner")

    await page.goto("/admin/mail/t080-mail-code")

    await expect(page.locator("[data-mail-body]")).toContainText("[секрет не показывается]")
    await expect(page.locator("[data-mail-body]")).not.toContainText("482913")
    await expect(page.locator("[data-mail-resend]")).toHaveCount(0)
  })

  test("the stored copy of a login mail keeps no token and cannot be repeated", async ({ page }) => {
    await authorize(page, "owner")

    await page.goto("/admin/mail/t080-mail-secret")

    await expect(page.locator("[data-mail-body]")).toContainText("[секрет не показывается]")
    await expect(page.locator("[data-mail-body]")).not.toContainText("token=")
    await expect(page.locator("[data-mail-resend]")).toHaveCount(0)
  })

  for (const role of ["analyst", "admin"] as const) {
    test(`${role} reads the masked address but has no repeat action`, async ({ page }) => {
      await authorize(page, role)

      await page.goto(`/admin/mail?template=${template}`)

      await expect(page.locator('[data-mail-row="t080-mail-failed"] [data-mail-recipient]')).toHaveText(maskedRecipient)
      await expect(page.locator("[data-mail-bulk-resend]")).toHaveCount(0)

      await page.goto("/admin/mail/t080-mail-failed")

      await expect(page.locator("[data-mail-body]")).toBeVisible()
      await expect(page.locator("[data-mail-resend]")).toHaveCount(0)
    })
  }

  for (const role of ["editor", "moderator"] as const) {
    test(`${role} sees mail of own articles without address and body`, async ({ page }) => {
      await authorize(page, role)

      await page.goto(`/admin/mail?template=${template}`)

      await expect(page.locator('[data-mail-row="t080-mail-failed"]')).toBeVisible()
      await expect(page.locator('[data-mail-row="t080-mail-failed"] [data-mail-recipient]')).not.toContainText("@")
      await expect(page.locator('[data-mail-row="t080-mail-queued"]')).toHaveCount(0)

      await page.goto("/admin/mail/t080-mail-failed")

      await expect(page.locator("[data-mail-body-hidden]")).toBeVisible()
      await expect(page.locator("[data-mail-body]")).toHaveCount(0)
    })

    test(`${role} receives HTTP 404 for a mail outside own articles`, async ({ page }) => {
      await authorize(page, role)

      await page.goto("/admin/mail/t080-mail-queued")

      await expect(page.locator('[data-mail-state="error"]')).toBeVisible()
      await expect(page.locator("[data-mail-card]")).toHaveCount(0)
    })
  }

  test("waiting mail raises the unavailable provider notice", async ({ page }) => {
    await authorize(page, "admin")

    await page.goto(`/admin/mail?template=${template}&status=queued`)

    await expect(page.locator("[data-mail-provider-waiting]")).toBeVisible()
  })

  test("an empty filter shows the empty state", async ({ page }) => {
    await authorize(page, "admin")

    await page.goto("/admin/mail?template=t080-no-such-template")

    await expect(page.locator('[data-mail-state="empty"]')).toBeVisible()
    await expect(page.locator("[data-mail-table]")).toHaveCount(0)
  })

  test("the list exposes a loading state while the history is being read", async ({ page }) => {
    await authorize(page, "admin")
    let release = () => {}
    let started = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    await page.route("**/api/graphql", async (route) => {
      if (!isOperation(route.request().postDataJSON(), "GetAdminMails")) return route.continue()
      started()
      await gate
      await route.continue()
    })

    const navigation = page.goto(`/admin/mail?template=${template}`)
    await requestStarted
    await expect(page.locator('[data-mail-state="loading"]')).toBeVisible()
    release()
    await navigation
    await expect(page.locator("[data-mail-table]")).toBeVisible()
  })

  test("a failed history query shows the error state with its requestId", async ({ page }) => {
    await authorize(page, "admin")
    await page.route("**/api/graphql", async (route) => {
      if (!isOperation(route.request().postDataJSON(), "GetAdminMails")) return route.continue()
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          errors: [{ message: "Internal server error", extensions: { code: "INTERNAL_ERROR", requestId: "req-mail" } }]
        })
      })
    })

    await page.goto(`/admin/mail?template=${template}`)

    await expect(page.locator('[data-mail-state="error"]')).toBeVisible()
    await expect(page.getByText("requestId: req-mail")).toBeVisible()
  })

  test("a repeated mail answers with the conflict state", async ({ page }) => {
    await authorize(page, "owner")
    await page.route("**/api/graphql", async (route) => {
      if (!isOperation(route.request().postDataJSON(), "ResendMail(")) return route.continue()
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          errors: [
            {
              message: "Conflict",
              extensions: { code: "CONFLICT", entity: "mailMessage", requestId: "req-conflict" }
            }
          ]
        })
      })
    })

    await page.goto("/admin/mail/t080-mail-failed")
    await page.locator("[data-mail-resend]").click()

    await expect(page.locator('[data-mail-state="conflict"]')).toBeVisible()
  })

  test("a bulk repeat above the maximum shows the limit state", async ({ page }) => {
    await authorize(page, "owner")
    await page.route("**/api/graphql", async (route) => {
      if (!isOperation(route.request().postDataJSON(), "ResendMails(")) return route.continue()
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          errors: [
            {
              message: "Validation error",
              extensions: { code: "VALIDATION_ERROR", field: "ids", rule: "max:100", requestId: "req-limit" }
            }
          ]
        })
      })
    })

    await page.goto(`/admin/mail?template=${template}`)
    await page.locator('[data-mail-select="t080-mail-failed"]').check()
    await page.locator("[data-mail-bulk-resend]").click()
    await page.locator("[data-mail-confirm-submit]").click()

    await expect(page.locator('[data-mail-state="limit"]')).toBeVisible()
  })

  test("author receives HTTP 403 and a guest is redirected to login", async ({ page }) => {
    await authorize(page, "author")
    const forbidden = await page.goto("/admin/mail")
    expect(forbidden?.status()).toBe(403)

    await page.setExtraHTTPHeaders({})
    await page.goto("/admin/mail")
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === "/admin/mail")
  })
})
