/**
 * Состояние для `/health` в Nuxt (реестр маршрутов #64, ADR-0032 п. 5): сам веб плюс ответ API с
 * состоянием зависимостей и возрастом резервных копий. Публичной страницы статуса нет
 * (журнал §20.16) — это служебный маршрут без данных пользователя, без ПДн и без секретов.
 */

export const HEALTH_STATUSES = ["ok", "degraded", "unavailable"] as const
export type HealthStatus = (typeof HEALTH_STATUSES)[number]

export interface ApiHealth {
  status: HealthStatus
  revision: string | null
  checkedAt: string | null
  checks: Record<string, unknown>
  components: Record<string, unknown>
  backups: Record<string, unknown>
}

export interface WebHealth {
  service: "web"
  status: HealthStatus
  revision: string | null
  checkedAt: string
  api: {
    reachable: boolean
    httpStatus: number | null
    health: ApiHealth | null
  }
}

/** Ответ API ждём не дольше его собственного предела проверки (`server/src/health/readiness.ts`). */
export const API_HEALTH_TIMEOUT_MS = 4000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asStatus = (value: unknown): HealthStatus | null =>
  typeof value === "string" && (HEALTH_STATUSES as readonly string[]).includes(value) ? (value as HealthStatus) : null

/** Ревизия деплоя — только валидный SHA, иначе `null` (то же правило, что на API). */
export const readRevision = (commit: string | undefined): string | null =>
  commit && /^[0-9a-f]{40}$/.test(commit) ? commit : null

/**
 * Поля переносятся по списку, а не копированием тела: веб не пересказывает наружу то, чего не
 * ждёт от API. Ответ без известного `status` считается непонятым, то есть API недоступным.
 */
export function readApiHealth(payload: unknown): ApiHealth | null {
  if (!isRecord(payload)) return null
  const status = asStatus(payload.status)
  if (!status) return null
  return {
    status,
    revision: typeof payload.revision === "string" ? payload.revision : null,
    checkedAt: typeof payload.checkedAt === "string" ? payload.checkedAt : null,
    checks: isRecord(payload.checks) ? payload.checks : {},
    components: isRecord(payload.components) ? payload.components : {},
    backups: isRecord(payload.backups) ? payload.backups : {}
  }
}

export interface WebHealthOptions {
  /** Адрес `GET /health` на API. */
  apiHealthUrl: string
  fetchJson: (url: string, init: { signal: AbortSignal }) => Promise<{ status: number; body: unknown }>
  commit?: string
  now?: () => Date
  timeoutMs?: number
}

export async function readWebHealth(options: WebHealthOptions): Promise<WebHealth> {
  const now = options.now ?? (() => new Date())
  let httpStatus: number | null = null
  let health: ApiHealth | null = null

  try {
    const response = await options.fetchJson(options.apiHealthUrl, {
      signal: AbortSignal.timeout(options.timeoutMs ?? API_HEALTH_TIMEOUT_MS)
    })
    httpStatus = response.status
    health = readApiHealth(response.body)
  } catch {
    // Недоступный или непонятый API — не отказ самого веба: маршрут отвечает и говорит об этом.
    health = null
  }

  // Сам веб исправен: обработчик выполнился. Итоговый статус приносит API — продукт без него
  // ничего не отдаёт, поэтому недоступный API даёт `unavailable`, а не деградацию.
  const status: HealthStatus = health ? health.status : "unavailable"

  return {
    service: "web",
    status,
    revision: readRevision(options.commit),
    checkedAt: now().toISOString(),
    api: { reachable: health !== null, httpStatus, health }
  }
}
