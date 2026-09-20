import {
  archiveStaffAccount,
  assignOwner,
  changeStaffRole,
  createStaff,
  deactivateOwner,
  getAdminStaffMember,
  listAdminStaff,
  listOwners,
  restoreStaffAccount,
  revokeOwner,
  revokeStaffRole,
  type AdminOwner,
  type AdminStaffFilters,
  type AdminStaffMember,
  type AssignableStaffRole
} from "../../admin/staff"
import type { GraphQLContext } from "../../prisma"

function presentMember(member: AdminStaffMember) {
  return {
    ...member,
    createdAt: member.createdAt.toISOString(),
    lastActiveAt: member.lastActiveAt?.toISOString() ?? null,
    archivedAt: member.archivedAt?.toISOString() ?? null,
    roleHistory: member.roleHistory.map((change) => ({
      id: change.id,
      action: change.action,
      before: change.before,
      after: change.after,
      actorName: change.actorName,
      reason: change.reason,
      createdAt: change.createdAt.toISOString()
    })),
    exceptions: member.exceptions.map((exception) => ({
      ...exception,
      startsAt: exception.startsAt.toISOString(),
      endsAt: exception.endsAt?.toISOString() ?? null,
      revokedAt: exception.revokedAt?.toISOString() ?? null,
      expiredAt: exception.expiredAt?.toISOString() ?? null
    }))
  }
}

function presentOwner(owner: AdminOwner) {
  return { ...owner, assignedAt: owner.assignedAt?.toISOString() ?? null }
}

export default {
  Query: {
    adminStaff: async (_parent: unknown, args: { filters?: AdminStaffFilters | null }, ctx: GraphQLContext) =>
      (await listAdminStaff(ctx, args.filters ?? {})).map(presentMember),
    adminStaffMember: async (_parent: unknown, args: { id: string }, ctx: GraphQLContext) => {
      const member = await getAdminStaffMember(ctx, args.id)
      return member ? presentMember(member) : null
    },
    owners: async (_parent: unknown, _args: Record<string, never>, ctx: GraphQLContext) =>
      (await listOwners(ctx)).map(presentOwner)
  },
  Mutation: {
    createStaff: async (
      _parent: unknown,
      args: { input: { email: string; role: AssignableStaffRole; name: string } },
      ctx: GraphQLContext
    ) => presentMember(await createStaff(ctx, args.input)),
    changeStaffRole: async (
      _parent: unknown,
      args: { id: string; role: AssignableStaffRole; reason: string },
      ctx: GraphQLContext
    ) => presentMember(await changeStaffRole(ctx, args)),
    revokeStaffRole: async (_parent: unknown, args: { id: string; reason: string }, ctx: GraphQLContext) =>
      presentMember(await revokeStaffRole(ctx, args)),
    assignOwner: async (_parent: unknown, args: { id: string }, ctx: GraphQLContext) =>
      presentMember(await assignOwner(ctx, args)),
    revokeOwner: async (_parent: unknown, args: { id: string; reason: string }, ctx: GraphQLContext) =>
      presentMember(await revokeOwner(ctx, args)),
    deactivateOwner: async (_parent: unknown, args: { id: string; reason: string }, ctx: GraphQLContext) =>
      presentMember(await deactivateOwner(ctx, args)),
    archiveStaffAccount: async (_parent: unknown, args: { id: string; reason: string }, ctx: GraphQLContext) =>
      presentMember(await archiveStaffAccount(ctx, args)),
    restoreStaffAccount: async (_parent: unknown, args: { id: string; reason: string }, ctx: GraphQLContext) =>
      presentMember(await restoreStaffAccount(ctx, args))
  }
}
