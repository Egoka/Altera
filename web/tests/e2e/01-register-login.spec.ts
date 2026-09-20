import { expect, test, type Page } from "@playwright/test"
import {
  createArchivedUser,
  ensurePublishedLegalVersions,
  readMagicLinkToken,
  uniqueEmail,
  withPrisma
} from "./helpers/auth-fixtures"

/**
 * Форма становится рабочей только после гидратации: до неё Vue не видит введённых значений,
 * а кнопка остаётся неактивной. Состояние `form` наступает после загрузки версий согласия,
 * то есть уже на гидрированной странице.
 */
const requestLink = async (page: Page, email: string) => {
  await expect(page.locator("[data-login-state='form']")).toBeVisible()
  await page.getByLabel(/адрес электронной почты/i).fill(email)
  await page.getByRole("checkbox").check()
  await page.getByRole("button", { name: /получить ссылку входа/i }).click()
  await expect(page.locator("[data-login-state='sent']")).toBeVisible()
}

// Flow #1: docs/spec/10-flows/register-and-login.md.
test("flow #1 registers or logs in without disclosing whether the account exists", async ({ page, request }) => {
  await ensurePublishedLegalVersions()
  const email = uniqueEmail("t022-flow1")

  await test.step("Шаг 1: запросить ссылку с e-mail и актуальным согласием", async () => {
    await page.goto("/login")
    await requestLink(page, email)
    await expect(page.getByText(email)).toBeVisible()
  })

  const token = await test.step("Шаг 2: открыть ссылку из письма", async () => {
    return readMagicLinkToken(request, email)
  })

  await test.step("Шаг 3: проверить токен и создать сессию без повторного использования", async () => {
    await page.goto(`/auth/verify?token=${token}`)
    await expect(page).toHaveURL(/\/me(?:\?|$)/)

    await page.goto(`/auth/verify?token=${token}`)
    await expect(page.locator("[data-verify-state='invalid']")).toBeVisible()
    await expect(page.getByText(/ссылка недействительна/i)).toBeVisible()
  })

  await test.step("Шаг 3а: аккаунт создан читателем с планом free и записанным согласием", async () => {
    const created = await withPrisma((prisma) =>
      prisma.user.findUnique({ where: { email }, include: { legalConsents: true } })
    )
    expect(created).toMatchObject({ role: "reader", planTier: "free", archivedAt: null })
    expect(created!.handle).toMatch(/^u-[0-9a-f]{8}$/)
    expect(created!.legalConsents).toHaveLength(2)
  })

  await test.step("Шаг 4: повторный вход существующего аккаунта не создаёт второй", async () => {
    await page.context().clearCookies()
    await page.goto("/login")
    await requestLink(page, email)

    const repeatToken = await readMagicLinkToken(request, email, token)
    await page.goto(`/auth/verify?token=${repeatToken}`)
    await expect(page).toHaveURL(/\/me(?:\?|$)/)

    const accounts = await withPrisma((prisma) => prisma.user.findMany({ where: { email } }))
    expect(accounts).toHaveLength(1)
  })

  await test.step("Шаг 5: самостоятельно архивированный аккаунт попадает на экран состояния", async () => {
    const archivedEmail = uniqueEmail("t022-archived-self")
    await createArchivedUser({ email: archivedEmail, mode: "self" })

    await page.context().clearCookies()
    await page.goto("/login")
    await requestLink(page, archivedEmail)

    const archivedToken = await readMagicLinkToken(request, archivedEmail)
    await page.goto(`/auth/verify?token=${archivedToken}`)
    await expect(page).toHaveURL(/\/me\/archived$/)

    // Сессия ограниченная: доступен только экран состояния (session-lifecycle.md п. 7).
    const sessions = await withPrisma((prisma) =>
      prisma.session.findMany({ where: { user: { email: archivedEmail } } })
    )
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.limited).toBe(true)
  })
})

test("the answer to a link request is the same for a known and an unknown address", async ({ page }) => {
  await ensurePublishedLegalVersions()
  const known = uniqueEmail("t022-known")
  const unknown = uniqueEmail("t022-unknown")

  await withPrisma(async (prisma) => {
    const handle = `t022-known-${Math.random().toString(16).slice(2, 10)}`
    await prisma.handleHistory.create({ data: { handle } })
    const user = await prisma.user.create({ data: { email: known, handle, name: "T022 known" } })
    await prisma.handleHistory.update({ where: { handle }, data: { userId: user.id } })
  })

  const requestLink = async (address: string) => {
    await page.goto("/login")
    await expect(page.locator("[data-login-state='form']")).toBeVisible()

    const response = await page.evaluate(
      async ([email, query]) => {
        const result = await fetch("/api/graphql", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, variables: { email } })
        })
        return { status: result.status, body: await result.json() }
      },
      [
        address,
        `mutation ($email: String!) {
          requestMagicLink(
            email: $email
            consentVersion: { termsVersion: 1, privacyVersion: 1 }
            locale: ru
          ) { ok retryAfterSec }
        }`
      ] as const
    )
    return response
  }

  expect(await requestLink(known)).toEqual(await requestLink(unknown))

  // Запрос по неизвестному адресу не заводит учётную запись (session-lifecycle.md п. 2).
  const created = await withPrisma((prisma) => prisma.user.findUnique({ where: { email: unknown } }))
  expect(created).toBeNull()
})
