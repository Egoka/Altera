import { SESSION_ACCESS_COOKIE } from "#shared/session"

// Закрытые страницы уводят гостя на вход и передают путь возврата
// (docs/spec/20-public/login.md §3). Роли и ограниченная сессия проверяются на сервере.
export default defineNuxtRouteMiddleware((to) => {
  if (!to.meta.requiresAuth) return

  const session = useCookie(SESSION_ACCESS_COOKIE)
  if (session.value) return

  return navigateTo({ path: "/login", query: { next: to.fullPath } }, { replace: true })
})
