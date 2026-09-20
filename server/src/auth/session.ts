import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"
import type { PrismaClient, User } from "../generated/prisma"
import { hashOpaqueToken } from "./token-hash"

if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error("JWT secrets must be defined in environment variables.")
}

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET
const JWT_ACCESS_TOKEN_EXPIRY = process.env.JWT_ACCESS_TOKEN_EXPIRY || "15m"
const JWT_REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_TOKEN_EXPIRY || "7d"

export interface AuthPayload {
  accessToken: string
  refreshToken: string
  user: User
}

type SessionClient = Pick<PrismaClient, "session">

/**
 * Сессия — запись в таблице (ADR-0009, `session-lifecycle.md` п. 3): хранится хэш refresh-токена.
 * Ротация, выход и обнаружение повторного предъявления — T-023. Роль в claim не кладётся
 * (ADR-0003 п. 4): она читается из базы на каждый запрос.
 */
export async function issueSession(
  prisma: SessionClient,
  user: User,
  options: { limited?: boolean; userAgent?: string | null; ip?: string | null } = {}
): Promise<AuthPayload> {
  const accessToken = jwt.sign({ userId: user.id }, JWT_ACCESS_SECRET, {
    expiresIn: JWT_ACCESS_TOKEN_EXPIRY
  } as jwt.SignOptions)

  const refreshToken = jwt.sign({ userId: user.id, jti: randomUUID() }, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_TOKEN_EXPIRY
  } as jwt.SignOptions)

  const decoded = jwt.decode(refreshToken)
  const expiresAtSeconds = typeof decoded === "object" && decoded !== null ? decoded.exp : undefined
  if (typeof expiresAtSeconds !== "number") throw new Error("Refresh token has no expiry claim")

  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashOpaqueToken(refreshToken),
      expiresAt: new Date(expiresAtSeconds * 1000),
      limited: options.limited ?? false,
      userAgent: options.userAgent ?? null,
      ip: options.ip ?? null
    },
    select: { id: true }
  })

  return { accessToken, refreshToken, user }
}
