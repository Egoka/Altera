import { readWebHealth } from "../utils/health"

/**
 * `/health` в Nuxt (реестр маршрутов #64, ADR-0032 п. 5, `08-operations.md` §7): состояние веба и
 * ответ API с зависимостями и возрастом резервных копий. Это служебный маршрут, а не страница
 * статуса — публичной страницы статуса нет (журнал §20.16), данных пользователя здесь не бывает.
 *
 * Код ответа всегда 200, пока обработчик выполняется: платформенная проверка веба не должна
 * ронять и перезапускать веб из-за недоступного API — перезапуск веба этого не лечит. Тяжесть
 * состояния несёт поле `status` в теле, по нему и оповещает внешняя проверка (T-106).
 */
export default defineEventHandler(async (event) => {
  const { graphqlApiUrl } = useRuntimeConfig(event)
  setHeader(event, "cache-control", "no-store")

  return readWebHealth({
    apiHealthUrl: new URL("/health", graphqlApiUrl).toString(),
    commit: process.env.RENDER_GIT_COMMIT,
    fetchJson: async (url, init) => {
      const response = await fetch(url, { signal: init.signal, headers: { accept: "application/json" } })
      return { status: response.status, body: await response.json() }
    }
  })
})
