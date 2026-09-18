import { getAdminSummary } from "../../admin/dashboard"
import type { GraphQLContext } from "../../prisma"

type AdminSummaryPeriod = "DAYS_7" | "DAYS_30"

export default {
  Query: {
    adminSummary: (_parent: unknown, { period }: { period: AdminSummaryPeriod }, ctx: GraphQLContext) =>
      getAdminSummary(ctx, period === "DAYS_30" ? 30 : 7)
  }
}
