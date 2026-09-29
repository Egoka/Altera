import { deletePermanently, previewPermanentDelete, type PermanentDeleteEntity } from "../../admin/permanent-delete"
import type { GraphQLContext } from "../../prisma"

export default {
  Query: {
    permanentDeletePreview: (
      _parent: unknown,
      { entity, id }: { entity: PermanentDeleteEntity; id: string },
      ctx: GraphQLContext
    ) => previewPermanentDelete(ctx, entity, id)
  },
  Mutation: {
    deletePermanently: (
      _parent: unknown,
      args: { entity: PermanentDeleteEntity; id: string; confirmedName: string; reason: string },
      ctx: GraphQLContext
    ) => deletePermanently(ctx, args)
  }
}
