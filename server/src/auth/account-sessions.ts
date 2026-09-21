/**
 * Список своих сессий для `/me/sessions` (`docs/spec/30-account/reader/sessions.md`).
 *
 * Наружу уходят только классы устройства и браузера: сырой `user-agent` и IP не показываются
 * и не возвращаются API (`50-access/rate-limits.md` п. 2, ADR-0027), а местоположение по IP
 * не вычисляется вовсе (журнал §25.9).
 */

export const SESSION_DEVICE_CLASSES = ["desktop", "mobile", "tablet", "unknown"] as const
export const SESSION_BROWSER_CLASSES = ["chrome", "safari", "firefox", "edge", "opera", "other", "unknown"] as const

export type SessionDeviceClass = (typeof SESSION_DEVICE_CLASSES)[number]
export type SessionBrowserClass = (typeof SESSION_BROWSER_CLASSES)[number]

export interface AccountSessionRow {
  id: string
  createdAt: Date
  lastUsedAt: Date
  userAgent: string | null
}

export interface AccountSessionView {
  id: string
  deviceClass: SessionDeviceClass
  browserClass: SessionBrowserClass
  createdAt: Date
  lastActiveAt: Date
  isCurrent: boolean
}

/** Узкая часть Prisma: список и отзыв проверяются без живой базы. */
export interface AccountSessionStore {
  session: {
    findMany(args: {
      where: { userId: string; revokedAt: null; expiresAt: { gt: Date } }
      orderBy: { lastUsedAt: "desc" }
    }): Promise<AccountSessionRow[]>
    findFirst(args: { where: { id: string; userId: string } }): Promise<{ id: string; revokedAt: Date | null } | null>
    updateMany(args: {
      where: { userId: string; revokedAt: null; id?: string | { not: string }; expiresAt?: { gt: Date } }
      data: { revokedAt: Date }
    }): Promise<{ count: number }>
  }
}

export type RevokeOwnSessionOutcome =
  | { status: "revoked" }
  /** Сессии нет, она чужая или уже завершена: существование чужой записи не раскрывается. */
  | { status: "not_found" }
  /** Текущую сессию закрывает «выйти», а не «отозвать» (§4 таблицы мутаций). */
  | { status: "current" }

const tabletMarkers = /\b(ipad|tablet|playbook|silk)\b/
const mobileMarkers = /\b(mobile|iphone|ipod|iemobile|opera mini)\b/

export function classifyDevice(userAgent: string | null): SessionDeviceClass {
  if (!userAgent) return "unknown"
  const value = userAgent.toLowerCase()

  if (tabletMarkers.test(value)) return "tablet"
  // Android без маркера `Mobile` — планшет: так этот класс различает сам Android (`[ДОПУЩЕНИЕ]` §12).
  if (value.includes("android") && !value.includes("mobile")) return "tablet"
  if (mobileMarkers.test(value) || value.includes("android")) return "mobile"
  if (/\b(windows|macintosh|mac os x|linux|cros|x11)\b/.test(value)) return "desktop"

  return "unknown"
}

export function classifyBrowser(userAgent: string | null): SessionBrowserClass {
  if (!userAgent) return "unknown"
  const value = userAgent.toLowerCase()

  // Порядок важен: Edge и Opera несут в строке и `chrome`, а Chrome — и `safari`.
  if (value.includes("edg/") || value.includes("edga/") || value.includes("edgios/")) return "edge"
  if (value.includes("opr/") || value.includes("opera")) return "opera"
  if (value.includes("firefox/") || value.includes("fxios/")) return "firefox"
  if (value.includes("chrome/") || value.includes("crios/") || value.includes("chromium/")) return "chrome"
  if (value.includes("safari/")) return "safari"

  return "other"
}

export function toAccountSessionView(row: AccountSessionRow, currentSessionId: string | null): AccountSessionView {
  return {
    id: row.id,
    deviceClass: classifyDevice(row.userAgent),
    browserClass: classifyBrowser(row.userAgent),
    createdAt: row.createdAt,
    lastActiveAt: row.lastUsedAt,
    isCurrent: currentSessionId !== null && row.id === currentSessionId
  }
}

/** Активные сессии одного аккаунта по убыванию последней активности (§5, зоны 3–4). */
export async function listAccountSessions(
  store: AccountSessionStore,
  userId: string,
  currentSessionId: string | null,
  now: Date = new Date()
): Promise<AccountSessionView[]> {
  const rows = await store.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { lastUsedAt: "desc" }
  })

  return rows.map((row) => toAccountSessionView(row, currentSessionId))
}

export async function revokeOwnSession(
  store: AccountSessionStore,
  input: { userId: string; sessionId: string; currentSessionId: string | null; now?: Date }
): Promise<RevokeOwnSessionOutcome> {
  const now = input.now ?? new Date()
  if (input.currentSessionId !== null && input.sessionId === input.currentSessionId) return { status: "current" }

  const session = await store.session.findFirst({ where: { id: input.sessionId, userId: input.userId } })
  if (!session || session.revokedAt) return { status: "not_found" }

  const { count } = await store.session.updateMany({
    where: { userId: input.userId, id: input.sessionId, revokedAt: null },
    data: { revokedAt: now }
  })
  // Параллельный отзыв той же строки уже закрыл сессию: экран показывает «уже завершена» (§8).
  return count > 0 ? { status: "revoked" } : { status: "not_found" }
}

/** «Выйти везде»: остаётся только текущая сессия (§7). */
export async function revokeOtherSessions(
  store: AccountSessionStore,
  input: { userId: string; currentSessionId: string | null; now?: Date }
): Promise<number> {
  const now = input.now ?? new Date()
  const { count } = await store.session.updateMany({
    where: {
      userId: input.userId,
      revokedAt: null,
      expiresAt: { gt: now },
      ...(input.currentSessionId ? { id: { not: input.currentSessionId } } : {})
    },
    data: { revokedAt: now }
  })

  return count
}
