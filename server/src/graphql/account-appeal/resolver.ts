import {
  decideAccountAppeal,
  readAccountAppeal,
  submitAccountAppeal,
  type AccountAppealDecision,
  type PublicAccountAppealView
} from "../../account/appeal"
import type { GraphQLContext } from "../../prisma"

const presentRecord = (appeal: PublicAccountAppealView["appeal"]) => ({
  ...appeal,
  submittedAt: appeal.submittedAt?.toISOString() ?? null,
  decidedAt: appeal.decidedAt?.toISOString() ?? null
})

export default {
  Query: {
    accountAppeal: async (_parent: unknown, { token }: { token: string }, ctx: GraphQLContext) => {
      const view = await readAccountAppeal(ctx, token)
      return {
        ...view,
        archivedAt: view.archivedAt.toISOString(),
        plan: view.plan ? { tier: view.plan.tier, until: view.plan.until.toISOString() } : null,
        appeal: presentRecord(view.appeal)
      }
    }
  },
  Mutation: {
    submitAccountAppeal: async (_parent: unknown, args: { token: string; message: string }, ctx: GraphQLContext) =>
      presentRecord(await submitAccountAppeal(ctx, args)),
    decideAppeal: async (
      _parent: unknown,
      args: { id: string; decision: AccountAppealDecision; reason: string },
      ctx: GraphQLContext
    ) => presentRecord((await decideAccountAppeal(ctx, args)).appeal)
  }
}
