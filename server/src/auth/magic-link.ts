import crypto from "crypto"
import { addMinutes } from "date-fns"
import { hashOpaqueToken } from "./token-hash"
import { createMagicLinkMail, MAGIC_LINK_TEMPLATE } from "../mail/messages"
import type { Locale, PrismaClient } from "../generated/prisma"
import type { MailService } from "../mail/service"

const MAGIC_LINK_EXPIRY_MINUTES = parseInt(process.env.MAGIC_LINK_EXPIRY_MINUTES || "15")
const MAGIC_LINK_BASE_URL = process.env.MAGIC_LINK_BASE_URL || "http://localhost:3000/auth/verify"

export type MagicLinkStore = Pick<PrismaClient, "magicLinkToken">

export const buildMagicLinkUrl = (token: string): string => {
  const url = new URL(MAGIC_LINK_BASE_URL)
  url.searchParams.set("token", token)
  return url.toString()
}

export interface IssueMagicLinkInput {
  userId: string
  email: string
  locale: Locale
  requestId: string
  now?: Date
}

/**
 * Одноразовая ссылка входа: та же ссылка обслуживает и обычный вход, и первый вход
 * новой служебной записи (`10-flows/appoint-admin.md` шаги 1–2).
 */
export async function issueMagicLink(
  store: MagicLinkStore,
  mail: MailService,
  input: IssueMagicLinkInput
): Promise<void> {
  const token = crypto.randomBytes(32).toString("hex")
  const tokenHash = hashOpaqueToken(token)
  const expiresAt = addMinutes(input.now ?? new Date(), MAGIC_LINK_EXPIRY_MINUTES)

  await store.magicLinkToken.upsert({
    where: { userId: input.userId },
    update: {
      tokenHash,
      expiresAt,
      usedAt: null // Ensure the token is marked as not used on update
    },
    create: {
      tokenHash,
      userId: input.userId,
      expiresAt
    }
  })

  const { message, sanitizedBody } = createMagicLinkMail(input.locale, buildMagicLinkUrl(token))
  await mail.send({
    template: MAGIC_LINK_TEMPLATE,
    to: input.email,
    content: { subject: message.subject, text: message.text, html: message.html },
    sanitizedBody,
    requestId: input.requestId
  })
}
