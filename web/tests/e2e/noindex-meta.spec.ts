import { expect, test } from "@playwright/test"
import { authenticateAdminPage } from "./helpers/admin-auth"
import { uniqueEmail, withPrisma } from "./helpers/auth-fixtures"
import { createSessionId, signAccessToken } from "./helpers/session-token"
import { SESSION_ACCESS_COOKIE } from "../../shared/session"

test("cabinet page /me has noindex meta tag", async ({ page }) => {
  // Без сессии кабинет уводит на вход (docs/spec/20-public/login.md §3). Сводка читает `me`,
  // поэтому нужна живая запись сессии, а не токен без `sid` (T-030).
  const { userId, sessionId } = await withPrisma(async (prisma) => {
    const handle = `t022-noindex-${Math.random().toString(16).slice(2, 10)}`
    await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
    const user = await prisma.user.create({
      data: { email: uniqueEmail("t022-noindex"), handle, name: "T022 noindex" }
    })
    await prisma.handleHistory.update({ where: { handle }, data: { userId: user.id } })
    return { userId: user.id, sessionId: await createSessionId(prisma, user.id) }
  })
  await page.context().addCookies([
    {
      name: SESSION_ACCESS_COOKIE,
      value: signAccessToken(userId, sessionId),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }
  ])
  await page.goto("/me")

  await expect(page).toHaveURL(/\/me$/)

  const robotsMeta = page.locator('meta[name="robots"]')
  await expect(robotsMeta).toHaveAttribute("content", /noindex/)
})

test("admin page /admin has noindex meta tag", async ({ page }) => {
  await authenticateAdminPage(page)
  await page.goto("/admin")

  const robotsMeta = page.locator('meta[name="robots"]')
  await expect(robotsMeta).toHaveAttribute("content", /noindex/)
})
