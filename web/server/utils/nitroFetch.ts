import type { FetchRaw } from "./graphqlProxy"

/**
 * Единственное место, где BFF вызывает `$fetch.raw`: типизация маршрутов Nitro разворачивается
 * на каждом таком вызове, и второе место давало `TS2321: Excessive stack depth` в проверке типов
 * серверного проекта (`web/scripts/typecheck.mjs`).
 */
export const nitroFetchRaw: FetchRaw = (url, options) => $fetch.raw(url, options)
