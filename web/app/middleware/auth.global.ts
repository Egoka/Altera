export default defineNuxtRouteMiddleware((to) => {
  const user = useAuth().value

  if (to.meta.requiresAuth && !user) {
    return navigateTo("/login")
  }

  if (to.meta.role && user?.role !== to.meta.role) {
    return abortNavigation({ statusCode: 403, message: "Access denied" })
  }
})
