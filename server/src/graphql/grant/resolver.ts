import { getAdminGrant, grantPlan, listAdminGrants, revokePlan, type AdminGrant } from "../../admin/grants"
import type { GraphQLContext } from "../../prisma"

function presentGrant(grant: AdminGrant) {
  return {
    id: grant.id,
    userId: grant.userId,
    userName: grant.user.name,
    userHandle: grant.user.handle,
    tier: grant.tier,
    startsAt: grant.startsAt.toISOString(),
    endsAt: grant.endsAt?.toISOString() ?? null,
    grantedByName: grant.grantedBy?.name ?? null,
    reason: grant.reason,
    status: grant.status,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    createdAt: grant.createdAt.toISOString()
  }
}

export default {
  Query: {
    adminGrants: async (_parent: unknown, _args: Record<string, never>, ctx: GraphQLContext) =>
      (await listAdminGrants(ctx)).map(presentGrant),
    adminGrant: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const grant = await getAdminGrant(ctx, id)
      return grant ? presentGrant(grant) : null
    }
  },
  Mutation: {
    grantPlan: async (_parent: unknown, { input }: { input: Parameters<typeof grantPlan>[1] }, ctx: GraphQLContext) =>
      presentGrant(await grantPlan(ctx, input)),
    revokePlan: async (_parent: unknown, { input }: { input: Parameters<typeof revokePlan>[1] }, ctx: GraphQLContext) =>
      presentGrant(await revokePlan(ctx, input))
  }
}
