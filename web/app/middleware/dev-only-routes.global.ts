const DEV_ONLY_ROUTES = new Set(["/fonts-showcase", "/components-showcase", "/test-error"])

export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.dev || !DEV_ONLY_ROUTES.has(to.path)) return

  return abortNavigation(
    createError({
      statusCode: 404,
      statusMessage: "Page Not Found"
    })
  )
})
