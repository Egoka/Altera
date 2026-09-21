import { createPageErrorReporter, pageErrorReport } from "~/utils/pageErrorReport"

/**
 * Сбор `page.error` в браузере (`80-observability/error-collector.md` §2 п. 1): фатальные ошибки
 * приложения, ошибки рендера компонентов и отказ, отрисованный сервером на странице 500.
 * Только клиент: серверный рендер своего `$fetch` к BFF для этого не делает.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()
  // Код запроса страницы 500 кладёт `error.vue`; для падения рендера другого источника нет.
  const pageRequestId = useState<string | null>("service.requestId", () => null)
  const report = createPageErrorReporter((url, options) => $fetch(url, options))
  const capture = (error: unknown) =>
    void report(pageErrorReport(error, router.currentRoute.value, pageRequestId.value))

  nuxtApp.hook("app:error", capture)
  nuxtApp.hook("vue:error", capture)

  const renderedError = useError()
  onNuxtReady(() => {
    if (renderedError.value) capture(renderedError.value)
  })
})
