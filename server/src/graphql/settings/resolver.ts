import { getSystemSettings, type SystemSettingsGroup } from "../../admin/settings"
import type { GraphQLContext } from "../../prisma"

export default {
  Query: {
    systemSettings: (_parent: unknown, { group }: { group: SystemSettingsGroup }, ctx: GraphQLContext) =>
      getSystemSettings(ctx, group)
  }
}
