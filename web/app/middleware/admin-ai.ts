import { canReadAiProcesses } from "~/utils/admin"

export default defineNuxtRouteMiddleware(() => {
  const { summary } = useAdminDashboard()
  if (!summary.value || !canReadAiProcesses(summary.value.role)) {
    throw createError({
      statusCode: 403,
      statusMessage: "AI processes require moderator, analyst, admin or owner role"
    })
  }
})
