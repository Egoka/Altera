import { SESSION_ACCESS_COOKIE } from "#shared/session"

/**
 * Закрытые страницы уводят гостя на вход и передают путь возврата
 * (docs/spec/20-public/login.md §3).
 *
 * Проверка делается только на сервере: сессия лежит в httpOnly-cookie, которую браузерный JS
 * прочитать не может (ADR-0023), поэтому на клиенте она всегда выглядела бы отсутствующей.
 * Доступ к данным закрывает сервер, а не этот редирект.
 */
export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.client || !to.meta.requiresAuth) return

  const session = useCookie(SESSION_ACCESS_COOKIE)
  if (session.value) return

  return navigateTo({ path: "/login", query: { next: to.fullPath } }, { replace: true, redirectCode: 302 })
})
