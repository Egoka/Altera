import type { TypedDocumentNode } from "@graphql-typed-document-node/core"
import { print, type ExecutionResult } from "graphql"

/**
 * Заголовки исходного запроса, которые во внутренний подзапрос не переносятся: часть из них
 * описывает соединение, а тело подзапроса всегда своё — JSON операции.
 */
const NOT_FORWARDED_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "connection",
  "content-length",
  "content-type",
  "expect",
  "keep-alive",
  "transfer-encoding",
  "upgrade"
])

/**
 * Единственный вход в BFF для всех операций. На SSR запрос уходит внутренним подзапросом Nitro,
 * и его `Set-Cookie` в ответ навигации сам не попадает: без переноса вход по ссылке из письма
 * не оставляет в браузере refresh-cookie (ADR-0023 п. 2, `session-lifecycle.md` §2.4). Поэтому
 * серверная ветка читает сырой ответ и дописывает его cookie в ответ страницы, а заголовки
 * запроса переносит сама — так же, как это делает `useRequestFetch`.
 */
export const useGraphQL = async <TResult, TVariables>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables?: TVariables
): Promise<ExecutionResult<TResult>> => {
  const request = { method: "POST" as const, body: { query: print(document), variables } }
  const event = import.meta.server ? useRequestEvent() : undefined

  if (!event) return useRequestFetch()<ExecutionResult<TResult>>("/api/graphql", request)

  const forwarded = Object.entries(useRequestHeaders()).filter(([name]) => !NOT_FORWARDED_HEADERS.has(name))
  const response = await $fetch.raw<ExecutionResult<TResult>>("/api/graphql", {
    ...request,
    // Контекст переносит платформенные поля внутреннего вызова (`_platform`, `waitUntil`); в типах
    // ofetch этого поля нет, читает его только Nitro.
    ...({ context: event.context } as Record<string, unknown>),
    headers: Object.fromEntries(forwarded)
  })

  for (const cookie of response.headers.getSetCookie()) {
    event.node.res.appendHeader("set-cookie", cookie)
  }

  return response._data as ExecutionResult<TResult>
}
