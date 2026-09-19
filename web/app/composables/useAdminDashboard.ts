import type { GetAdminSummaryQuery } from "~/graphql/generated/graphql"
import { GetAdminSummaryDocument } from "~/graphql/generated/graphql"
import { getAdminAccessDecision, parseAdminPeriod, type AdminAccessDecision } from "~/utils/admin"

export const useAdminDashboard = () => {
  const summary = useState<GetAdminSummaryQuery["adminSummary"] | null>("admin.summary", () => null)
  const loading = ref(false)
  const failed = ref(false)
  const requestId = useState<string | null>("admin.summary.requestId", () => null)
  const route = useRoute()

  const load = async (target: string): Promise<AdminAccessDecision> => {
    const period = parseAdminPeriod(route.query.period)
    const envelope = await useGraphQL(GetAdminSummaryDocument, {
      period: period === 30 ? "DAYS_30" : "DAYS_7"
    })
    const decision = getAdminAccessDecision(envelope, target)

    if (decision.kind === "allow") {
      summary.value = decision.summary
      failed.value = false
      requestId.value = null
    } else if (decision.kind === "error") {
      failed.value = true
      requestId.value = decision.requestId
    }

    return decision
  }

  const refresh = async () => {
    loading.value = true
    failed.value = false
    await nextTick()
    try {
      await load(route.fullPath.split("#", 1)[0] ?? route.path)
    } catch {
      failed.value = true
      requestId.value = null
    } finally {
      loading.value = false
    }
  }

  return { summary, loading, failed, requestId, load, refresh }
}
