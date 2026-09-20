import { isIP } from "node:net"

/**
 * Ключ корзины по адресу (`rate-limits.md` §2 п. 2: лимиты по IP применяются до аутентификации).
 *
 * Адрес приходит заголовком `x-forwarded-for`, который ставит собственный BFF. Заголовок
 * доверенный только у запроса с сошедшейся подписью пересланного `x-request-id`: её считает
 * общий секрет, снаружи её не подделать. Поэтому:
 *
 * - `client` — адрес, пересланный BFF: своя корзина на адрес;
 * - `internal` — петлевой адрес у доверенного запроса: локальный и сквозной прогон, вызов
 *   подсистемы. Это «системные вызовы» исключений §3, лимит по адресу к ним не применяется;
 * - `unverified` — запрос мимо BFF или без адреса: одна общая корзина. Открывать лимит такому
 *   запросу нельзя — иначе подстановка заголовка снимала бы защиту, — а раздавать каждому свою
 *   корзину значит не лимитировать вовсе.
 */
export type RateLimitAddress =
  | { readonly kind: "client"; readonly key: string }
  | { readonly kind: "internal" }
  | { readonly kind: "unverified"; readonly key: string }

export const UNVERIFIED_ADDRESS_KEY = "unverified"

const isLoopback = (value: string): boolean =>
  value === "::1" || value === "::ffff:127.0.0.1" || value.startsWith("127.")

export function resolveRateLimitAddress(ip: string | null | undefined, forwardedByBff: boolean): RateLimitAddress {
  if (!forwardedByBff || !ip || !isIP(ip)) return { kind: "unverified", key: UNVERIFIED_ADDRESS_KEY }
  if (isLoopback(ip)) return { kind: "internal" }

  return { kind: "client", key: ip }
}
