import { canReadSystemSettings } from "~/utils/admin"

export default defineNuxtRouteMiddleware(() => {
  const { summary } = useAdminDashboard()
  if (!summary.value || !canReadSystemSettings(summary.value.role)) {
    throw createError({ statusCode: 403, statusMessage: "System settings require admin or owner role" })
  }
})
