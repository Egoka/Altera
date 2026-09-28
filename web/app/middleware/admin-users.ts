import { canReadUsers } from "~/utils/admin"

export default defineNuxtRouteMiddleware(() => {
  const { summary } = useAdminDashboard()
  if (!summary.value || !canReadUsers(summary.value.role)) {
    throw createError({ statusCode: 403, statusMessage: "Users section requires analyst, admin or owner role" })
  }
})
