import { createHmac } from "node:crypto"
import type { APIRequestContext, Page } from "@playwright/test"
import { PrismaClient } from "../../../../server/src/generated/prisma/index.js"
import { SESSION_ACCESS_COOKIE } from "../../../shared/session"

const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const mailpitUrl = process.env.T021_MAILPIT_URL ?? "http://127.0.0.1:28025"

export const withPrisma = async <T>(run: (prisma: PrismaClient) => Promise<T>): Promise<T> => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  try {
    return await run(prisma)
  } finally {
    await prisma.$disconnect()
  }
}

export interface PublishedLegalVersions {
  termsVersion: number
  privacyVersion: number
}

/**
 * Без опубликованных текстов согласие невалидно (docs/spec/20-public/login.md §8), поэтому
 * сценарии входа поднимают минимальный набор сами. Механизм версий и страницы `/legal/*` — T-101.
 */
export const ensurePublishedLegalVersions = async (
  locale: "ru" | "en" = "ru",
  versions: PublishedLegalVersions = { termsVersion: 1, privacyVersion: 1 }
): Promise<PublishedLegalVersions> =>
  withPrisma(async (prisma) => {
    for (const [kind, version] of [
      ["terms", versions.termsVersion],
      ["privacy", versions.privacyVersion]
    ] as const) {
      await prisma.legalText.upsert({
        where: { kind_locale_version: { kind, locale, version } },
        update: { status: "published", publishedAt: new Date() },
        create: {
          kind,
          locale,
          version,
          status: "published",
          body: `E2E ${kind} v${version}`,
          summaryOfChanges: "e2e fixture",
          publishedAt: new Date()
        }
      })
    }
    return versions
  })

export interface ArchivedUserInput {
  email: string
  mode: "self" | "admin" | "emergency"
  locale?: "ru" | "en"
}

export const createArchivedUser = async ({ email, mode, locale = "ru" }: ArchivedUserInput): Promise<string> =>
  withPrisma(async (prisma) => {
    const handle = `t022-${Math.random().toString(16).slice(2, 10)}`
    await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
    const user = await prisma.user.create({
      data: {
        email,
        handle,
        locale,
        name: "T022 archived",
        archivedAt: new Date(),
        archiveMode: mode
      }
    })
    await prisma.handleHistory.update({ where: { handle }, data: { userId: user.id } })
    return user.id
  })

interface MailpitSearch {
  messages: { ID: string }[]
}

interface MailpitMessage {
  Text: string
}

/**
 * Достаёт одноразовую ссылку входа из локального приёмника писем (T-021). `notToken`
 * нужен для повторного запроса: письмо с прежним токеном остаётся в ящике.
 */
export const readMagicLinkToken = async (
  request: APIRequestContext,
  email: string,
  notToken?: string
): Promise<string> => {
  const deadline = Date.now() + 20_000

  for (;;) {
    const search = await request.get(`${mailpitUrl}/api/v1/search`, { params: { query: `to:"${email}"` } })
    const messages = ((await search.json()) as MailpitSearch).messages

    for (const message of messages) {
      const delivered = (await (
        await request.get(`${mailpitUrl}/api/v1/message/${message.ID}`)
      ).json()) as MailpitMessage
      const token = delivered.Text.match(/\/auth\/verify\?token=([0-9a-f]{64})/)?.[1]
      if (token && token !== notToken) return token
    }

    if (Date.now() > deadline) throw new Error(`No fresh login link delivered to ${email}`)
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

export const uniqueEmail = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.test`

const accessSecret = "t009-test-access-secret"

const signAccessToken = (userId: string): string => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900, userId })).toString(
    "base64url"
  )
  const unsigned = `${header}.${payload}`
  return `${unsigned}.${createHmac("sha256", accessSecret).update(unsigned).digest("base64url")}`
}

/** Кладёт сессию в тот же httpOnly-cookie, что ставит BFF после подтверждения ссылки. */
export const setSessionCookie = async (page: Page, userId: string): Promise<void> => {
  await page.context().addCookies([
    {
      name: SESSION_ACCESS_COOKIE,
      value: signAccessToken(userId),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }
  ])
}

/** То же, но с настоящей учётной записью в базе: нужна там, где запрос доходит до API. */
export const authenticateSessionCookie = async (page: Page, email: string): Promise<string> => {
  const userId = await withPrisma(async (prisma) => {
    const handle = `t022-session-${Math.random().toString(16).slice(2, 10)}`
    await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
    const user = await prisma.user.create({ data: { email, handle, name: "T022 session" } })
    await prisma.handleHistory.update({ where: { handle }, data: { userId: user.id } })
    return user.id
  })

  await setSessionCookie(page, userId)

  return userId
}
