/**
 * Код запроса для страницы 500 (`docs/spec/20-public/error.md` §4, журнал §28.4).
 *
 * Сначала берётся `requestId` из самого отказа — его кладёт туда прокси GraphQL
 * (`web/server/utils/graphqlProxy.ts`, T-087). Падение рендера своего отказа не приносит,
 * поэтому запасной источник — `requestId` текущего запроса из контекста Nitro.
 *
 * На 404 код не вычисляется вовсе: это обычное пользовательское состояние.
 */
export const serviceRequestId = (
  error: { statusCode?: number; data?: unknown } | null | undefined,
  eventRequestId?: unknown
): string | null => {
  if ((error?.statusCode ?? 500) === 404) return null

  const data = error?.data
  if (data && typeof data === "object" && typeof (data as { requestId?: unknown }).requestId === "string") {
    return (data as { requestId: string }).requestId
  }

  return typeof eventRequestId === "string" && eventRequestId ? eventRequestId : null
}
