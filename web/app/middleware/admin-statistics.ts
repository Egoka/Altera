import { canReadStatistics } from "~/utils/admin"

export default defineNuxtRouteMiddleware(() => {
  const { summary } = useAdminDashboard()
  if (!summary.value || !canReadStatistics(summary.value.role)) {
    throw createError({ statusCode: 403, statusMessage: "Statistics section requires analyst, admin or owner role" })
  }
})
