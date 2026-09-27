import { isIP } from "node:net"

/**
 * Ключ корзины по адресу (`rate-limits.md` §2 п. 2: лимиты по IP применяются до аутентификации).
 *
 * Адрес приходит заголовком `x-forwarded-for`, который ставит собственный BFF, а тот берёт его
 * из элемента, добавленного доверенным прокси площадки (`web/server/utils/clientAddress.ts`).
 * Заголовок доверенный только у запроса с сошедшейся подписью пересланного `x-request-id`: её
 * считает общий секрет, снаружи её не подделать. Поэтому:
 *
 * - `client` — адрес, пересланный BFF: своя корзина на адрес;
 * - `unverified` — запрос мимо BFF или без адреса: одна общая корзина. Открывать лимит такому
 *   запросу нельзя — иначе подстановка заголовка снимала бы защиту, — а раздавать каждому свою
 *   корзину значит не лимитировать вовсе.
 *
 * Исключения по самому адресу здесь нет: петлевой адрес — такая же клиентская корзина. Системные
 * вызовы исключений §3 через это middleware не проходят вовсе — воркер (`src/jobs`) работает
 * внутри процесса, `/health` отвечает до Yoga (`src/health.ts`), вебхука провайдера в схеме нет,
 * — поэтому «петлевой адрес» их признаком не является: им прикрывался любой запрос, сумевший
 * подставить `X-Forwarded-For: 127.0.0.1`.
 */
export type RateLimitAddress =
  | { readonly kind: "client"; readonly key: string }
  | { readonly kind: "unverified"; readonly key: string }

export const UNVERIFIED_ADDRESS_KEY = "unverified"

export function resolveRateLimitAddress(ip: string | null | undefined, forwardedByBff: boolean): RateLimitAddress {
  if (!forwardedByBff || !ip || !isIP(ip)) return { kind: "unverified", key: UNVERIFIED_ADDRESS_KEY }

  return { kind: "client", key: ip }
}
