export default defineNuxtRouteMiddleware(async (to) => {
  const { load } = useAdminDashboard()
  const target = to.fullPath.split("#", 1)[0] ?? to.path
  const decision = await load(target)

  if (decision.kind === "redirect") {
    return navigateTo(decision.to, { redirectCode: 302 })
  }

  if (decision.kind === "forbidden") {
    throw createError({ statusCode: 403, statusMessage: "Admin access is limited to service accounts" })
  }

  if (decision.kind === "error") {
    throw createError({
      statusCode: 500,
      statusMessage: "Admin dashboard is unavailable",
      data: decision.requestId ? { requestId: decision.requestId } : undefined
    })
  }
})
