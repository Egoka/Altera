import { canReadLegalTexts } from "~/utils/admin"

export default defineNuxtRouteMiddleware(() => {
  const { summary } = useAdminDashboard()
  if (!summary.value || !canReadLegalTexts(summary.value.role)) {
    throw createError({ statusCode: 403, statusMessage: "Legal texts require admin or owner role" })
  }
})
