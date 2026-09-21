import { GetAccountDashboardDocument, type GetAccountDashboardQuery } from "~/graphql/generated/graphql"

export type AccountDashboard = NonNullable<GetAccountDashboardQuery["me"]>

interface GraphQLEnvelope {
  data?: GetAccountDashboardQuery | null
  errors?: readonly { extensions?: Record<string, unknown> | null }[]
}

// Кабинет читателя и автора есть только у личных ролей: служебная запись изолирована (журнал §25.2).
const personalRoles = new Set(["reader", "author"])

export const useAccountDashboardState = () => useState<AccountDashboard | null>("account-dashboard", () => null)

/**
 * Редиректы сводки `/me` (`docs/spec/30-account/reader/dashboard.md` §3, §8) решаются до
 * рендера, чтобы первый ответ сервера был 302, а не страница с последующим уходом: служебная
 * запись — в `/admin`, ограниченная сессия — на `/me/archived`, гость — на вход.
 * `me` не ответил — страница ошибки 500 с `requestId` (строка «Ошибка данных»).
 */
export default defineNuxtRouteMiddleware(async () => {
  const state = useAccountDashboardState()

  let envelope: GraphQLEnvelope
  try {
    envelope = (await useGraphQL(GetAccountDashboardDocument)) as GraphQLEnvelope
  } catch {
    throw createError({ statusCode: 500, statusMessage: "Account dashboard is unavailable" })
  }

  const account = envelope.data?.me
  if (!account) {
    const extensions = envelope.errors?.[0]?.extensions
    if (extensions?.code === "FORBIDDEN") return navigateTo("/me/archived", { replace: true, redirectCode: 302 })
    if (extensions?.code === "UNAUTHENTICATED") {
      return navigateTo({ path: "/login", query: { next: "/me" } }, { replace: true, redirectCode: 302 })
    }

    const requestId = typeof extensions?.requestId === "string" ? extensions.requestId : null
    throw createError({
      statusCode: 500,
      statusMessage: "Account dashboard is unavailable",
      data: requestId ? { requestId } : undefined
    })
  }

  if (!personalRoles.has(account.role) || !account.subscription) {
    return navigateTo("/admin", { replace: true, redirectCode: 302 })
  }

  state.value = account
})
