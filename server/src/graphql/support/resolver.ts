import type { GraphQLContext } from "../../prisma"
import {
  createSupportRequest,
  listMySupportRequests,
  type MySupportRequest,
  type SupportRequestInput,
  type SupportRequestStore
} from "../../support/requests"

const presentMine = (request: MySupportRequest) => ({
  ...request,
  createdAt: request.createdAt.toISOString(),
  answeredAt: request.answeredAt?.toISOString() ?? null
})

/**
 * Письмо в редакцию и сообщение о битой ссылке (матрица #117): права не проверяются — мутация
 * открыта гостю, аккаунту и сотруднику одинаково; защита — лимит по адресу в middleware и по
 * аккаунту в домене (`rate-limits.md` §2 п. 4).
 */
export default {
  Query: {
    mySupportRequests: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      const requests = await listMySupportRequests({
        store: ctx.prisma as unknown as SupportRequestStore,
        actor: ctx.currentUser,
        requestId: ctx.requestId
      })
      return requests.map(presentMine)
    }
  },
  AccountUser: {
    isArchived: (parent: { archivedAt?: Date | null }) => Boolean(parent.archivedAt)
  },
  Mutation: {
    createSupportRequest: (_: unknown, args: SupportRequestInput, ctx: GraphQLContext) =>
      createSupportRequest(
        {
          store: ctx.prisma as unknown as SupportRequestStore,
          actor: ctx.currentUser,
          requestId: ctx.requestId,
          mail: ctx.mail,
          logger: ctx.logger,
          rateLimiter: ctx.rateLimiter,
          ip: ctx.requestMeta?.ip
        },
        args
      )
  }
}
