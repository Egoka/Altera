import { canReadReviews } from "~/utils/admin"

export default defineNuxtRouteMiddleware(() => {
  const { summary } = useAdminDashboard()
  if (!summary.value || !canReadReviews(summary.value.role)) {
    throw createError({ statusCode: 403, statusMessage: "Review section requires moderator, admin or owner role" })
  }
})
