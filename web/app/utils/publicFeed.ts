import type { ExecutionResult } from "graphql"

/** Локаль запроса к API: словарь знает больше кодов, выдача различает только два языка. */
export type RequestLocale = "ru" | "en"
export const requestLocale = (locale: string): RequestLocale => (locale === "en" ? "en" : "ru")

interface GraphQLErrorLike {
  extensions?: Readonly<Record<string, unknown>>
}

const codeOf = (errors?: readonly GraphQLErrorLike[]): string | undefined => {
  const value = errors?.[0]?.extensions?.code
  return typeof value === "string" ? value : undefined
}

/** Код запроса из отказа: его страница показывает читателю в `ErrorState`. */
export const feedRequestId = (errors?: readonly GraphQLErrorLike[]): string | undefined => {
  const value = errors?.[0]?.extensions?.requestId
  return typeof value === "string" ? value : undefined
}

/**
 * Отказ API превращается в состояние страницы: «не найдено» и неверный параметр адреса —
 * 404 страницы #21, всё остальное — 500 с кодом запроса (`section-feed.md` §8).
 * `VALIDATION_ERROR` тоже даёт 404: такой адрес не ведёт никуда, и подменять его первой
 * страницей значит показывать не то, что в URL.
 */
export const throwOnFeedError = <T>(result: ExecutionResult<T>): T => {
  if (!result.errors?.length && result.data) return result.data

  const code = codeOf(result.errors)
  if (code === "NOT_FOUND" || code === "VALIDATION_ERROR") {
    throw createError({ statusCode: 404, statusMessage: "NOT_FOUND", fatal: true })
  }

  throw createError({
    statusCode: 500,
    statusMessage: "INTERNAL_ERROR",
    fatal: false,
    data: { requestId: feedRequestId(result.errors) }
  })
}

/**
 * Отказ «не найдено» превращается в настоящий ответ 404.
 *
 * Ошибка, брошенная внутри обработчика `useAsyncData`, остаётся значением `error` и не
 * меняет код ответа: страница отрисовалась бы с кодом 200. Строки «Не найдено» §8
 * обещают 404 и страницу #21, поэтому такой отказ пробрасывается из `setup` наружу.
 * Отказ данных (500) намеренно остаётся внутри страницы: `ErrorState` показывается на
 * месте, а шапка и футер сохраняются.
 */
export const rethrowNotFound = (error: unknown): void => {
  if ((error as { statusCode?: number } | null)?.statusCode !== 404) return
  throw createError({ statusCode: 404, statusMessage: "NOT_FOUND", fatal: true })
}

/** Код запроса из уже пойманной ошибки страницы. */
export const errorRequestId = (error: unknown): string | undefined => {
  const data = (error as { data?: { requestId?: string } } | null)?.data
  return typeof data?.requestId === "string" ? data.requestId : undefined
}

/**
 * Номер страницы из адреса. Отсутствие параметра — первая страница; всё, что не целое
 * число от единицы, отдаётся серверу как есть и возвращается отказом: страница не
 * угадывает за читателя, какой адрес он имел в виду.
 */
export const pageParam = (value: unknown): number => {
  if (value === undefined || value === null || value === "") return 1
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : -1
}

/** Первое значение строкового параметра адреса; пустая строка считается отсутствием. */
export const stringParam = (value: unknown): string | null => {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === "string" && raw.trim() ? raw.trim() : null
}

/** Адрес с параметрами: пустые значения не пишутся, страница 1 не попадает в адрес. */
export const withQuery = (path: string, params: Record<string, string | number | null | undefined>): string => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue
    if (key === "page" && Number(value) <= 1) continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}
