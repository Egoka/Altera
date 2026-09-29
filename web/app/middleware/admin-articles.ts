import { canReadArticles } from "~/utils/admin"

export default defineNuxtRouteMiddleware(() => {
  const { summary } = useAdminDashboard()
  if (!summary.value || !canReadArticles(summary.value.role)) {
    throw createError({ statusCode: 403, statusMessage: "Articles section requires editorial staff role" })
  }
})
