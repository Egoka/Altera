import { issueAccessToken } from "./access-token"
import { startSession, type SessionClient, type SessionMeta } from "./session"
import type { User } from "../generated/prisma"

/**
 * Выдача сессии после успешного входа — общая для обеих веток входа (журнал §34 п. 6: ссылка и
 * пароль равноправны). Хранилище сессий и ротацию refresh даёт T-023, полезная нагрузка —
 * контракт входа T-022, поэтому вход по паролю возвращает ровно ту же форму, что подтверждение
 * ссылки, и BFF переносит refresh в httpOnly-cookie одинаково (ADR-0023 п. 2).
 */
export interface IssuedLoginSession {
  accessToken: string
  refreshToken: string
  user: User
  sessionId: string
}

export async function issueLoginSession(
  client: SessionClient,
  user: User,
  meta: SessionMeta | null | undefined,
  options: { limited?: boolean; now?: Date } = {}
): Promise<IssuedLoginSession> {
  // Метаданные запроса приходят от BFF; серверные и тестовые вызовы могут их не передавать.
  const { session, refreshToken } = await startSession(
    client,
    user.id,
    meta ?? { userAgent: null, ip: null },
    options.now ?? new Date(),
    { limited: options.limited ?? false }
  )

  return { accessToken: issueAccessToken(user.id, session.id), refreshToken, user, sessionId: session.id }
}
