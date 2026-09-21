import type { LegalTextKind, LegalTextStatus, Locale } from "../../generated/prisma"
import type { GraphQLContext } from "../../prisma"
import {
  createLegalDraft,
  getAdminLegalVersion,
  listAdminLegalKinds,
  listAdminLegalVersions,
  publishLegalDraft,
  type AdminLegalVersionRow,
  type CreateLegalDraftInput,
  type PublishLegalDraftInput
} from "../../admin/legal"

const iso = (date: Date | null): string | null => date?.toISOString() ?? null

function presentVersion<T extends AdminLegalVersionRow>(row: T) {
  return {
    ...row,
    publishedAt: iso(row.publishedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

export default {
  Query: {
    adminLegalKinds: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) =>
      (await listAdminLegalKinds(ctx)).map((kind) => ({
        ...kind,
        locales: kind.locales.map((state) => ({ ...state, publishedAt: iso(state.publishedAt) }))
      })),
    adminLegalVersions: async (
      _parent: unknown,
      args: { kind?: LegalTextKind | null; locale?: Locale | null; status?: LegalTextStatus | null },
      ctx: GraphQLContext
    ) => (await listAdminLegalVersions(ctx, args)).map(presentVersion),
    adminLegalVersion: async (
      _parent: unknown,
      args: { kind: LegalTextKind; locale: Locale; version: number },
      ctx: GraphQLContext
    ) => {
      const detail = await getAdminLegalVersion(ctx, args)
      return detail ? presentVersion(detail) : null
    }
  },
  Mutation: {
    createLegalDraft: async (_parent: unknown, { input }: { input: CreateLegalDraftInput }, ctx: GraphQLContext) =>
      presentVersion(await createLegalDraft(ctx, input)),
    publishLegalVersion: async (_parent: unknown, { input }: { input: PublishLegalDraftInput }, ctx: GraphQLContext) =>
      presentVersion(await publishLegalDraft(ctx, input))
  }
}
