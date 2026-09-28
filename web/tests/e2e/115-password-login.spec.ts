import { expect, test, type Page } from "./helpers/test"
import {
  ensurePublishedLegalVersions,
  readAuthLinkToken,
  readMagicLinkToken,
  resetRateLimitCounters,
  uniqueEmail,
  withPrisma
} from "./helpers/auth-fixtures"

/**
 * T-115, критерии 1 и 2 (журнал §34 п. 6–8): регистрация по ссылке и с паролем обе создают
 * аккаунт; при регистрации с паролем вход до подтверждения адреса невозможен; аккаунт без
 * пароля входит по ссылке. Ветка сброса проверяется здесь же: письмо, новый пароль, вход им.
 */

// Пароль проходит утверждённые требования: 15…128 символов, не из blocklist, без частей адреса.
const PASSWORD = "тихий вечер у большой реки"
const NEW_PASSWORD = "восемь синих виноградин утром"

test.beforeEach(resetRateLimitCounters)

const openPasswordForm = async (page: Page) => {
  await page.goto("/login")
  await expect(page.locator("[data-login-state='form']")).toBeVisible()
  await page.getByTestId("login-mode-password").click()
  await expect(page.locator("[data-login-mode='password']")).toBeVisible()
}

const signInWithPassword = async (page: Page, email: string, password: string) => {
  await openPasswordForm(page)
  await page.getByLabel(/адрес электронной почты/i).fill(email)
  await page.getByTestId("login-password").fill(password)
  await page.getByTestId("login-submit").click()
}

test("flow #1 branch: registering with a password needs a confirmed address before the first login", async ({
  page,
  request
}) => {
  await ensurePublishedLegalVersions()
  const email = uniqueEmail("t115-password")

  await test.step("Шаг 1: регистрация с паролем создаёт аккаунт и отправляет письмо", async () => {
    await openPasswordForm(page)
    await page.getByTestId("login-to-register").click()
    await page.getByLabel(/адрес электронной почты/i).fill(email)
    await page.getByTestId("login-password").fill(PASSWORD)
    await page.getByRole("checkbox").check()
    await page.getByTestId("login-submit").click()
    await expect(page.getByTestId("login-confirm-sent")).toBeVisible()

    const created = await withPrisma((prisma) => prisma.user.findUnique({ where: { email } }))
    expect(created).toMatchObject({ role: "reader", planTier: "free", emailVerifiedAt: null })
    // Хранится PHC-строка Argon2id, а не пароль (утверждённые требования п. 6).
    expect(created!.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
    expect(created!.passwordHash).not.toContain(PASSWORD)
  })

  await test.step("Шаг 2: до подтверждения адреса вход по паролю не даёт сессии", async () => {
    await signInWithPassword(page, email, PASSWORD)
    await expect(page.locator("[data-login-state='unconfirmed']")).toBeVisible()

    const sessions = await withPrisma((prisma) => prisma.session.findMany({ where: { user: { email } } }))
    expect(sessions).toHaveLength(0)
  })

  const token = await test.step("Шаг 3: письмо подтверждения приходит со ссылкой", async () =>
    readAuthLinkToken(request, email, { path: "/auth/confirm" }))

  await test.step("Шаг 4: переход по ссылке подтверждает адрес и создаёт сессию", async () => {
    await page.goto(`/auth/confirm?token=${token}`)
    await expect(page).toHaveURL(/\/me(?:\?|$)/)

    const confirmed = await withPrisma((prisma) => prisma.user.findUnique({ where: { email } }))
    expect(confirmed!.emailVerifiedAt).not.toBeNull()

    // Ссылка одноразовая: второй переход по ней уже недействителен.
    await page.goto(`/auth/confirm?token=${token}`)
    await expect(page.locator("[data-confirm-state='invalid']")).toBeVisible()
  })

  await test.step("Шаг 5: после подтверждения вход по паролю работает", async () => {
    await page.context().clearCookies()
    await signInWithPassword(page, email, PASSWORD)
    await expect(page).toHaveURL(/\/me(?:\?|$)/)
  })

  await test.step("Шаг 6: неверный пароль сессии не даёт и не раскрывает аккаунт", async () => {
    await page.context().clearCookies()
    await signInWithPassword(page, email, "совсем другая длинная фраза")
    await expect(page.getByTestId("login-error")).toHaveText(/неверный адрес или пароль/i)
  })
})

test("an account created by a link stays passwordless and signs in by link", async ({ page, request }) => {
  await ensurePublishedLegalVersions()
  const email = uniqueEmail("t115-link-only")

  await page.goto("/login")
  await expect(page.locator("[data-login-state='form']")).toBeVisible()
  await page.getByLabel(/адрес электронной почты/i).fill(email)
  await page.getByRole("checkbox").check()
  await page.getByTestId("login-submit").click()
  await expect(page.locator("[data-login-state='sent']")).toBeVisible()

  const token = await readMagicLinkToken(request, email)
  await page.goto(`/auth/verify?token=${token}`)
  await expect(page).toHaveURL(/\/me(?:\?|$)/)

  // Аккаунт создан без пароля и таким остаётся (журнал §34 п. 8).
  const created = await withPrisma((prisma) => prisma.user.findUnique({ where: { email } }))
  expect(created).toMatchObject({ passwordHash: null })
  expect(created!.emailVerifiedAt).not.toBeNull()

  await test.step("пароль можно задать в кабинете, вход по ссылке при этом остаётся", async () => {
    await page.goto("/me/password")
    await expect(page.locator("[data-password-state='ready']")).toBeVisible()
    await page.getByTestId("password-new").fill(PASSWORD)
    await page.getByTestId("password-submit").click()
    await expect(page.getByTestId("password-saved")).toBeVisible()

    await page.context().clearCookies()
    await signInWithPassword(page, email, PASSWORD)
    await expect(page).toHaveURL(/\/me(?:\?|$)/)
  })
})

test("a forgotten password is reset by e-mail and the old one stops working", async ({ page, request }) => {
  await ensurePublishedLegalVersions()
  const email = uniqueEmail("t115-reset")

  await test.step("аккаунт с паролем и подтверждённым адресом", async () => {
    await openPasswordForm(page)
    await page.getByTestId("login-to-register").click()
    await page.getByLabel(/адрес электронной почты/i).fill(email)
    await page.getByTestId("login-password").fill(PASSWORD)
    await page.getByRole("checkbox").check()
    await page.getByTestId("login-submit").click()
    await expect(page.getByTestId("login-confirm-sent")).toBeVisible()

    const token = await readAuthLinkToken(request, email, { path: "/auth/confirm" })
    await page.goto(`/auth/confirm?token=${token}`)
    await expect(page).toHaveURL(/\/me(?:\?|$)/)
    await page.context().clearCookies()
  })

  await test.step("запрос сброса отвечает одинаково и присылает ссылку", async () => {
    await openPasswordForm(page)
    await page.getByTestId("login-to-reset").click()
    await page.getByLabel(/адрес электронной почты/i).fill(email)
    await page.getByTestId("login-submit").click()
    await expect(page.getByTestId("login-reset-sent")).toBeVisible()
  })

  const resetToken = await readAuthLinkToken(request, email, { path: "/auth/reset" })

  await test.step("новый пароль по ссылке пускает в кабинет", async () => {
    await page.goto(`/auth/reset?token=${resetToken}`)
    await expect(page.locator("[data-reset-state='form']")).toBeVisible()
    await page.getByTestId("reset-password").fill(NEW_PASSWORD)
    await page.getByTestId("reset-submit").click()
    await expect(page).toHaveURL(/\/me(?:\?|$)/)
  })

  await test.step("прежний пароль больше не подходит, новый — да", async () => {
    await page.context().clearCookies()
    await signInWithPassword(page, email, PASSWORD)
    await expect(page.getByTestId("login-error")).toBeVisible()

    await page.context().clearCookies()
    await signInWithPassword(page, email, NEW_PASSWORD)
    await expect(page).toHaveURL(/\/me(?:\?|$)/)
  })
})
