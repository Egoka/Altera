import { canReadSupportRequests } from "~/utils/admin"

export default defineNuxtRouteMiddleware(() => {
  const { summary } = useAdminDashboard()
  if (!summary.value || !canReadSupportRequests(summary.value.role)) {
    throw createError({ statusCode: 403, statusMessage: "Support queue requires admin or owner role" })
  }
})
