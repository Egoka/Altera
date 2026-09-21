import { print } from "graphql"
import { ReportPageErrorDocument } from "~/graphql/generated/graphql"

/**
 * Ошибка страницы `page.error` (реестр событий #64, `80-observability/error-collector.md` §2 п. 1):
 * фронт сообщает о сбое рендера или запроса в собственную историю ошибок. Поля — только из
 * реестра: шаблон маршрута, код и `requestId`. Стек, адрес страницы с параметрами и сведения о
 * пользователе не отправляются (§2 п. 5, п. 8).
 */
export interface PageErrorReport {
  route: string
  code: string
  requestId: string | null
}

/** Код для ошибки без HTTP-статуса: упал рендер компонента или код страницы. */
export const RENDER_ERROR_CODE = "RENDER"

const REPORT_PAGE_ERROR = print(ReportPageErrorDocument)

interface ReportableError {
  statusCode?: number
  data?: unknown
}

interface MatchedRoute {
  matched: readonly { path: string }[]
}

const requestIdOf = (error: ReportableError): string | null => {
  const data = error.data
  if (data && typeof data === "object" && typeof (data as { requestId?: unknown }).requestId === "string") {
    return (data as { requestId: string }).requestId
  }
  return null
}

/**
 * Отчёт или `null`, если это не сбой. 4xx — обычные состояния страницы (404, 410, нет прав),
 * а не ошибки фронта (§3: ожидаемые ошибки в сборщик не попадают). Маршрут берётся шаблоном
 * записи роутера (`/articles/:slug()`), поэтому значения параметров в историю не попадают.
 */
export const pageErrorReport = (
  error: unknown,
  route: MatchedRoute,
  fallbackRequestId: string | null = null
): PageErrorReport | null => {
  const reportable: ReportableError = error && typeof error === "object" ? (error as ReportableError) : {}
  const statusCode = typeof reportable.statusCode === "number" ? reportable.statusCode : undefined
  if (statusCode !== undefined && statusCode < 500) return null

  const template = route.matched.at(-1)?.path
  if (!template) return null

  return {
    route: template,
    code: statusCode === undefined ? RENDER_ERROR_CODE : String(statusCode),
    requestId: requestIdOf(reportable) ?? fallbackRequestId
  }
}

type PostGraphQL = (
  url: string,
  options: { method: "POST"; body: { query: string; variables: PageErrorReport } }
) => Promise<unknown>

/**
 * Отправитель с защитой от повторов: одна и та же ошибка на странице (повторный рендер, цикл
 * запросов) уходит один раз за жизнь вкладки. Сбой отправки глушится — сообщение об ошибке
 * не должно порождать новую ошибку страницы.
 */
export const createPageErrorReporter = (post: PostGraphQL) => {
  const sent = new Set<string>()

  return async (report: PageErrorReport | null): Promise<boolean> => {
    if (!report) return false
    const key = `${report.route}\n${report.code}\n${report.requestId ?? ""}`
    if (sent.has(key)) return false
    sent.add(key)

    try {
      await post("/api/graphql", { method: "POST", body: { query: REPORT_PAGE_ERROR, variables: report } })
      return true
    } catch {
      return false
    }
  }
}
