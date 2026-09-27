import { randomBytes } from "node:crypto"
import { addDays } from "date-fns"
import { hashOpaqueToken } from "./token-hash"

// ADR-0009 п. 1 и `docs/spec/50-access/session-lifecycle.md` §2.5: refresh живёт 30 дней от последней ротации.
export const SESSION_TTL_DAYS = 30
const REFRESH_TOKEN_BYTES = 32

export interface SessionRow {
  id: string
  userId: string
  tokenHash: string
  previousTokenHash: string | null
  expiresAt: Date
  revokedAt: Date | null
}

interface SessionWriteData {
  tokenHash?: string
  previousTokenHash?: string | null
  expiresAt?: Date
  revokedAt?: Date
  lastUsedAt?: Date
  userAgent?: string | null
  ip?: string | null
  userId?: string
  limited?: boolean
}

// Узкая часть Prisma, которой пользуются сессии: логика проверяется без живой базы.
export interface SessionClient {
  session: {
    create(args: { data: SessionWriteData & { userId: string } }): Promise<SessionRow>
    findUnique(args: { where: { tokenHash: string } }): Promise<SessionRow | null>
    findFirst(args: { where: { previousTokenHash: string } }): Promise<SessionRow | null>
    updateMany(args: {
      where: { userId?: string; id?: string; tokenHash?: string; revokedAt: null }
      data: SessionWriteData
    }): Promise<{ count: number }>
  }
}

export interface SessionMeta {
  userAgent: string | null
  ip: string | null
}

export interface IssuedSession {
  session: SessionRow
  refreshToken: string
}

export function createRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString("hex")
}

export function sessionExpiry(now: Date): Date {
  return addDays(now, SESSION_TTL_DAYS)
}

/**
 * `limited` — сессия самостоятельно архивированного аккаунта: она существует, но открывает
 * только экран состояния (`docs/spec/50-access/session-lifecycle.md` п. 7, контракт T-022).
 */
export async function startSession(
  client: SessionClient,
  userId: string,
  meta: SessionMeta,
  now: Date = new Date(),
  options: { limited?: boolean } = {}
): Promise<IssuedSession> {
  const refreshToken = createRefreshToken()
  const session = await client.session.create({
    data: {
      userId,
      tokenHash: hashOpaqueToken(refreshToken),
      expiresAt: sessionExpiry(now),
      lastUsedAt: now,
      userAgent: meta.userAgent,
      ip: meta.ip,
      limited: options.limited ?? false
    }
  })

  return { session, refreshToken }
}

export type RotationOutcome =
  | ({ status: "rotated" } & IssuedSession)
  | { status: "reuse_detected"; userId: string; sessionId: string; revokedCount: number }
  | { status: "expired" | "revoked"; sessionId: string; userId: string }
  | { status: "unknown" }

export async function revokeAllSessions(
  client: SessionClient,
  userId: string,
  now: Date = new Date()
): Promise<number> {
  const { count } = await client.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now }
  })
  return count
}

export async function revokeSession(client: SessionClient, sessionId: string, now: Date = new Date()): Promise<number> {
  const { count } = await client.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now }
  })
  return count
}

/**
 * Ротация refresh-токена (ADR-0009 п. 3). Предъявленный токен уже ротированной сессии означает
 * утечку: отзываются все сессии пользователя, а не только цепочка предъявленного токена
 * (`docs/spec/50-access/session-lifecycle.md` §2.4, критерий AC-1 задачи T-023).
 *
 * Замена `tokenHash` условная: `updateMany` требует, чтобы в строке всё ещё лежал предъявленный
 * хэш и сессия не была отозвана. Без условия два параллельных обмена одним токеном оба считали
 * бы себя победителями, и пара победителя терялась бы поверх пары проигравшего (T-124 AC-2).
 */
export async function rotateSession(
  client: SessionClient,
  presentedToken: string,
  meta: SessionMeta,
  now: Date = new Date()
): Promise<RotationOutcome> {
  const tokenHash = hashOpaqueToken(presentedToken)
  const current = await client.session.findUnique({ where: { tokenHash } })

  if (current) {
    if (current.revokedAt) return { status: "revoked", sessionId: current.id, userId: current.userId }
    if (current.expiresAt <= now) return { status: "expired", sessionId: current.id, userId: current.userId }

    const refreshToken = createRefreshToken()
    const rotation = {
      tokenHash: hashOpaqueToken(refreshToken),
      previousTokenHash: current.tokenHash,
      expiresAt: sessionExpiry(now),
      lastUsedAt: now,
      userAgent: meta.userAgent,
      ip: meta.ip
    }
    const { count } = await client.session.updateMany({
      where: { id: current.id, tokenHash: current.tokenHash, revokedAt: null },
      data: rotation
    })

    if (count > 0) {
      return {
        status: "rotated",
        session: {
          ...current,
          tokenHash: rotation.tokenHash,
          previousTokenHash: rotation.previousTokenHash,
          expiresAt: rotation.expiresAt
        },
        refreshToken
      }
    }
  }

  return resolvePresentedAgain(client, tokenHash, now, current !== null)
}

/**
 * Предъявленный токен уже не является текущим: его либо сменил параллельный обмен, либо сессию
 * отозвали между чтением и заменой. Исход тот же, что у повторного предъявления, — проигравшая
 * гонку сторона не получает `unknown` и не остаётся без ответа (T-124).
 */
async function resolvePresentedAgain(
  client: SessionClient,
  tokenHash: string,
  now: Date,
  lostRotation: boolean
): Promise<RotationOutcome> {
  const rotated = await client.session.findFirst({ where: { previousTokenHash: tokenHash } })
  if (rotated) {
    return {
      status: "reuse_detected",
      userId: rotated.userId,
      sessionId: rotated.id,
      revokedCount: await revokeAllSessions(client, rotated.userId, now)
    }
  }

  if (!lostRotation) return { status: "unknown" }

  // Строка с этим хэшем осталась на месте: замену отклонил отзыв сессии, а не гонка обмена.
  const kept = await client.session.findUnique({ where: { tokenHash } })
  if (kept?.revokedAt) return { status: "revoked", sessionId: kept.id, userId: kept.userId }
  if (kept && kept.expiresAt <= now) return { status: "expired", sessionId: kept.id, userId: kept.userId }

  return { status: "unknown" }
}

export async function findSessionByRefreshToken(
  client: SessionClient,
  presentedToken: string
): Promise<SessionRow | null> {
  return client.session.findUnique({ where: { tokenHash: hashOpaqueToken(presentedToken) } })
}
