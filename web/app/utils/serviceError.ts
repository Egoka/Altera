/**
 * Код запроса для страницы 500 (`docs/spec/20-public/error.md` §4, журнал §28.4).
 *
 * Сначала берётся `requestId` из самого отказа — его кладёт туда прокси GraphQL
 * (`web/server/utils/graphqlProxy.ts`, T-087). Падение рендера своего отказа не приносит,
 * поэтому запасной источник — `requestId` текущего запроса из контекста Nitro.
 *
 * На клиентских статусах код не вычисляется вовсе: журнал §28.4 оставил его техническим сбоям,
 * а 404 «нет такой страницы» и 403 «нет доступа» — обычные пользовательские состояния.
 */
export const serviceRequestId = (
  error: { statusCode?: number; data?: unknown } | null | undefined,
  eventRequestId?: unknown
): string | null => {
  if ((error?.statusCode ?? 500) < 500) return null

  const data = error?.data
  if (data && typeof data === "object" && typeof (data as { requestId?: unknown }).requestId === "string") {
    return (data as { requestId: string }).requestId
  }

  return typeof eventRequestId === "string" && eventRequestId ? eventRequestId : null
}
