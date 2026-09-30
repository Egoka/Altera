import {
  exportStatisticsCsv,
  getAiStatistics,
  getContentStatistics,
  getGrowthStatistics,
  type StatisticsRangeInput,
  type StatisticsTab
} from "../../admin/statistics"
import type { GraphQLContext } from "../../prisma"

interface RangeArgs {
  range: StatisticsRangeInput
}

export default {
  Query: {
    statisticsGrowth: (_parent: unknown, { range }: RangeArgs, ctx: GraphQLContext) => getGrowthStatistics(ctx, range),
    statisticsContent: (_parent: unknown, { range }: RangeArgs, ctx: GraphQLContext) =>
      getContentStatistics(ctx, range),
    statisticsAi: (_parent: unknown, { range }: RangeArgs, ctx: GraphQLContext) => getAiStatistics(ctx, range)
  },
  Mutation: {
    exportStatistics: (_parent: unknown, { tab, range }: RangeArgs & { tab: StatisticsTab }, ctx: GraphQLContext) =>
      exportStatisticsCsv(ctx, { tab, range })
  }
}
