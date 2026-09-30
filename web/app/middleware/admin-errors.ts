import { canReadErrors } from "~/utils/admin"

export default defineNuxtRouteMiddleware(() => {
  const { summary } = useAdminDashboard()
  if (!summary.value || !canReadErrors(summary.value.role)) {
    throw createError({ statusCode: 403, statusMessage: "Errors and health require admin or owner role" })
  }
})
