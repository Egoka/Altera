import type { MailTransport } from "../mail/transport"
import { quarantineKey } from "../storage/keys"
import type { ObjectStorage } from "../storage/types"
import { throttleAsync } from "./throttle"

/**
 * Компоненты состояния системы (§29.3, `80-observability/health-and-alerts.md` п. 1):
 * база, кеш, провайдер платежей, AI, почта и хранилище медиа. Набор и имена совпадают с тем,
 * что показывает раздел #22 (`40-admin/errors-and-health.md` §3).
 */
export const COMPONENT_NAMES = ["db", "redis", "psp", "ai", "mail", "storage"] as const
export type ComponentName = (typeof COMPONENT_NAMES)[number]

/** Провайдеры, состояние которых проверяется отдельно от готовности процесса. */
export const PROVIDER_NAMES = ["psp", "ai", "mail", "storage"] as const
export type ProviderName = (typeof PROVIDER_NAMES)[number]

/** `disabled` — провайдер не подключён: это не деградация (ADR-0019 про Redis, журнал §34). */
export type ComponentStatus = "up" | "down" | "disabled"

export interface ComponentState {
  status: ComponentStatus
  /**
   * Имя адаптера: `postgres`, `redis`, `smtp`, `console`, `s3`, `local`. Значений настроек и
   * секретов здесь нет — тот же приём, что в `admin/settings.ts` (§27.6, §28.11).
   */
  adapter: string | null
  latencyMs: number | null
}

export type ProviderProbe = () => Promise<ComponentState>

export const disabledComponent = (): ComponentState => ({ status: "disabled", adapter: null, latencyMs: null })

export const downComponent = (adapter: string | null = null): ComponentState => ({
  status: "down",
  adapter,
  latencyMs: null
})

const elapsed = (startedAt: number): number => Math.max(0, Date.now() - startedAt)

// Ключа карантина с нулевым UUID в хранилище нет: `exists` только спрашивает провайдера и ничего
// не пишет и не читает. Отдельный вид ключа для проверки не нужен (`storage-layout.md` §6).
const PROBE_KEY = quarantineKey({ assetId: "00000000-0000-0000-0000-000000000000" })

/**
 * Хранилище медиа: недоступный провайдер даёт `down` и деградацию без 503 — остальное работает
 * (`health-and-alerts.md` п. 7). `unconfigured` — драйвер не задан в production: любая операция
 * падает как недоступный провайдер, поэтому это `down`, а не `disabled`.
 */
export const createStorageProbe =
  (storage: Pick<ObjectStorage, "name" | "exists">): ProviderProbe =>
  async () => {
    if (storage.name === "unconfigured") return downComponent(null)
    const startedAt = Date.now()
    try {
      await storage.exists(PROBE_KEY)
      return { status: "up", adapter: storage.name, latencyMs: elapsed(startedAt) }
    } catch {
      return { status: "down", adapter: storage.name, latencyMs: elapsed(startedAt) }
    }
  }

export interface MailHistoryClient {
  mailMessage: {
    findFirst(args: {
      where: { status: { in: readonly ["sent", "failed"] } }
      orderBy: { updatedAt: "desc" }
      select: { status: true }
    }): Promise<{ status: string } | null>
  }
}

/**
 * У транспорта почты статус-эндпоинта нет, поэтому состояние берётся по последним реальным
 * отправкам (`health-and-alerts.md` п. 2): если последняя завершённая отправка отказала —
 * `down`. `bounced` в расчёт не идёт: это отказ получателя, а не провайдера.
 */
export const createMailProbe = (options: {
  transport: Pick<MailTransport, "name">
  client: MailHistoryClient
}): ProviderProbe => {
  const adapter = options.transport.name
  return async () => {
    if (adapter === "unconfigured") return downComponent(null)
    const startedAt = Date.now()
    try {
      const latest = await options.client.mailMessage.findFirst({
        where: { status: { in: ["sent", "failed"] } },
        orderBy: { updatedAt: "desc" },
        select: { status: true }
      })
      return {
        status: latest?.status === "failed" ? "down" : "up",
        adapter,
        latencyMs: elapsed(startedAt)
      }
    } catch {
      // История отправок недоступна вместе с базой: её состояние уже отражает `db`.
      return { status: "down", adapter, latencyMs: elapsed(startedAt) }
    }
  }
}

/**
 * Провайдеры, которых в коде ещё нет: AI-проверка — T-048, платежи — этап платности (журнал §42
 * п. 1: F-01 идёт последним). Пока они `disabled`: отсутствие подключения не деградация.
 */
export const createProviderProbes = (options: {
  storage: Pick<ObjectStorage, "name" | "exists">
  mail: Pick<MailTransport, "name">
  mailHistory: MailHistoryClient
  intervalMs?: number
}): Record<ProviderName, ProviderProbe> => {
  const throttle = (probe: ProviderProbe) => throttleAsync(probe, options.intervalMs)
  return {
    storage: throttle(createStorageProbe(options.storage)),
    mail: throttle(createMailProbe({ transport: options.mail, client: options.mailHistory })),
    ai: async () => disabledComponent(),
    psp: async () => disabledComponent()
  }
}
