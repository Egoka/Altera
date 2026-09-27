import { isIP } from "node:net"

/**
 * Адрес клиента для лимитов частоты по IP (`docs/spec/50-access/rate-limits.md` §2 п. 2).
 *
 * `X-Forwarded-For` — список, в который каждый прокси дописывает справа адрес, который он
 * увидел сам. Всё, что левее добавленного первым доверенным прокси, прислал клиент, и подделать
 * это может любой: самый левый элемент адресом клиента считать нельзя, иначе заголовок
 * `X-Forwarded-For: 127.0.0.1` снимает лимит по адресу.
 *
 * Поэтому адрес берётся справа: `trustedProxyHops` — сколько доверенных прокси стоит перед BFF.
 * Из `hops` прокси правые `hops - 1` элемента дописали сами доверенные прокси (каждый — адрес
 * предыдущего), а нужный адрес добавил самый внешний из них. Если списка не хватает или его нет,
 * остаётся адрес соединения: значит доверенный прокси заголовок не проставил.
 *
 * Число прокси — свойство площадки, а не продуктовое правило: за Cloudflare и Gateway их два
 * (`docs/infrastructure/cloudflare-altera-com.md` п. 4.2.6), на Render — один `[ДОПУЩЕНИЕ]`.
 */
export const DEFAULT_TRUSTED_PROXY_HOPS = 1

export interface TrustedClientAddressInput {
  /** Значение заголовка `X-Forwarded-For` целиком, как оно пришло. */
  forwardedFor?: string | null
  /** Адрес соединения: его подставить снаружи нельзя. */
  socketAddress?: string | null
  trustedProxyHops?: number | null
}

/** Целое число прокси не меньше одного: ноль означал бы доверие клиентскому заголовку. */
const normalizeHops = (value: number | null | undefined): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : DEFAULT_TRUSTED_PROXY_HOPS

export function resolveTrustedClientAddress(input: TrustedClientAddressInput): string | undefined {
  const hops = normalizeHops(input.trustedProxyHops)
  const forwarded = (input.forwardedFor ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  // Правые `hops - 1` элементов дописали доверенные прокси между собой; следующий справа —
  // адрес, который увидел самый внешний доверенный прокси.
  const candidate = forwarded[forwarded.length - hops] ?? input.socketAddress ?? null

  // Непроверенное значение лучше не передавать вовсе: лимит посчитает такой запрос в общей
  // корзине, а не откроет ему свою (`server/src/rate-limits/client-address.ts`).
  return candidate && isIP(candidate) ? candidate : undefined
}
