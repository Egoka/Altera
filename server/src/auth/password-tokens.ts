import { randomBytes } from "node:crypto"
import { addMinutes } from "date-fns"
import { hashOpaqueToken } from "./token-hash"
import type { Locale, PasswordToken, PasswordTokenPurpose, PrismaClient } from "../generated/prisma"

/**
 * Одноразовые токены ветки пароля (журнал §34 п. 7): подтверждение адреса после регистрации с
 * паролем и сброс забытого пароля. Правила те же, что у ссылки входа
 * (`50-access/session-lifecycle.md` п. 1): в базе лежит только хэш, срок общий с ссылкой входа,
 * токен одноразовый, повторный запрос того же вида отзывает прежний токен адреса.
 */

const TOKEN_BYTES = 32

export type PasswordTokenStore = Pick<PrismaClient, "passwordToken">

/** Срок жизни — общий параметр одноразовых ссылок входа; отдельного числа спецификация не даёт. */
export const passwordTokenExpiryMinutes = (): number => parseInt(process.env.MAGIC_LINK_EXPIRY_MINUTES || "15")

/**
 * Адреса писем ветки пароля берутся из того же настроенного адреса, что и ссылка входа: своя
 * переменная окружения на каждый экран рассинхронизировалась бы при первом же переносе домена.
 */
export function buildSiteUrl(pathname: string): string {
  const base = process.env.MAGIC_LINK_BASE_URL || "http://localhost:3000/auth/verify"
  const url = new URL(base)
  url.pathname = pathname
  url.search = ""

  return url.toString()
}

export function buildAuthUrl(pathname: string, token: string): string {
  const url = new URL(buildSiteUrl(pathname))
  url.searchParams.set("token", token)

  return url.toString()
}

export interface IssuedPasswordToken {
  token: string
  expiresAt: Date
}

export async function issuePasswordToken(
  store: PasswordTokenStore,
  input: { email: string; purpose: PasswordTokenPurpose; locale: Locale; next?: string | null; now?: Date }
): Promise<IssuedPasswordToken> {
  const token = randomBytes(TOKEN_BYTES).toString("hex")
  const expiresAt = addMinutes(input.now ?? new Date(), passwordTokenExpiryMinutes())
  const payload = {
    tokenHash: hashOpaqueToken(token),
    locale: input.locale,
    next: input.next ?? null,
    expiresAt,
    usedAt: null
  }

  await store.passwordToken.upsert({
    where: { email_purpose: { email: input.email, purpose: input.purpose } },
    update: payload,
    create: { email: input.email, purpose: input.purpose, ...payload }
  })

  return { token, expiresAt }
}

/**
 * Неизвестный, использованный и истёкший токен неотличимы снаружи: возвращается `null`, а
 * решение об ответе принимает вызывающий — как у ссылки входа (`20-public/verify.md` §4).
 */
export async function findUsablePasswordToken(
  store: PasswordTokenStore,
  token: string,
  purpose: PasswordTokenPurpose,
  now: Date = new Date()
): Promise<PasswordToken | null> {
  const record = await store.passwordToken.findUnique({ where: { tokenHash: hashOpaqueToken(token) } })
  if (!record || record.purpose !== purpose || record.usedAt || record.expiresAt <= now) return null

  return record
}

/**
 * Гашение — условный UPDATE с проверкой числа строк, а не запись после чтения: два параллельных
 * перехода по одной ссылке иначе оба доходили бы до смены пароля.
 */
export async function consumePasswordToken(
  store: PasswordTokenStore,
  record: PasswordToken,
  now: Date = new Date()
): Promise<boolean> {
  const { count } = await store.passwordToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: now }
  })

  return count === 1
}

/** Открытые токены адреса больше не нужны: пароль уже сменён или адрес уже подтверждён. */
export async function dropPasswordTokens(
  store: PasswordTokenStore,
  email: string,
  purposes: readonly PasswordTokenPurpose[]
): Promise<void> {
  await store.passwordToken.deleteMany({ where: { email, purpose: { in: [...purposes] } } })
}
