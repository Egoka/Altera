import jwt from "jsonwebtoken"

/**
 * Access-токен сессии (ADR-0009 п. 2, `50-access/session-lifecycle.md` §2). В клейме только
 * аккаунт и сессия: роль и план читаются из базы на каждый запрос, поэтому их смена действует
 * немедленно (ADR-0003 п. 4, п. 8 того же раздела).
 *
 * Модуль отдельный, потому что токен выдают два места: вход по ссылке (`graphql/auth`) и
 * самостоятельное восстановление аккаунта (`account/archive.ts`, матрица #116).
 */
const accessSecret = (): string => {
  const secret = process.env.JWT_ACCESS_SECRET
  if (!secret) throw new Error("JWT_ACCESS_SECRET must be defined in environment variables.")
  return secret
}

const accessTokenExpiry = (): string => process.env.JWT_ACCESS_TOKEN_EXPIRY || "15m"

export const issueAccessToken = (userId: string, sessionId: string): string =>
  jwt.sign({ userId, sid: sessionId }, accessSecret(), { expiresIn: accessTokenExpiry() } as jwt.SignOptions)
