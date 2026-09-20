import { createHash, createHmac, randomBytes } from "node:crypto"

// Совпадает с `JWT_ACCESS_SECRET` тестового API из `playwright.config.ts`.
const accessSecret = "t009-test-access-secret"
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

interface SessionStore {
  session: {
    create(args: { data: { userId: string; tokenHash: string; expiresAt: Date } }): Promise<{ id: string }>
  }
}

/**
 * После T-023 access-токен авторизует запрос только вместе с живой записью сессии,
 * поэтому фикстура создаёт её и кладёт идентификатор в клейм `sid`.
 * Роль в токен не входит: сервер читает её из базы на каждый запрос.
 */
export async function createSessionId(prisma: SessionStore, userId: string): Promise<string> {
  const refreshToken = randomBytes(32).toString("hex")
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: createHash("sha256").update(refreshToken, "utf8").digest("hex"),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS)
    }
  })

  return session.id
}

export function signAccessToken(userId: string, sessionId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900, sid: sessionId, userId })
  ).toString("base64url")
  const unsigned = `${header}.${payload}`

  return `${unsigned}.${createHmac("sha256", accessSecret).update(unsigned).digest("base64url")}`
}
