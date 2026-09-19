import { canManageTaxonomy } from "~/utils/admin"

export default defineNuxtRouteMiddleware(() => {
  const { summary } = useAdminDashboard()
  if (!summary.value || !canManageTaxonomy(summary.value.role)) {
    throw createError({ statusCode: 403, statusMessage: "Taxonomy access requires admin or owner role" })
  }
})
