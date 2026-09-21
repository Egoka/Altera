import { PageErrorValidationError, type PageErrorInput } from "../../error-collector"
import { createApiError } from "../../errors/graphql-error"
import type { GraphQLContext } from "../../prisma"

/**
 * Приём `page.error` с фронта в собственную историю и внешний сборщик. Права не проверяются:
 * ошибка страницы бывает у гостя так же, как у сотрудника.
 */
export default {
  Mutation: {
    reportPageError: async (_: unknown, args: PageErrorInput, ctx: GraphQLContext): Promise<boolean> => {
      try {
        await ctx.errorCollector.capturePageError(args)
        return true
      } catch (error: unknown) {
        if (error instanceof PageErrorValidationError) {
          throw createApiError("VALIDATION_ERROR", { requestId: ctx.requestId, field: error.field, rule: "format" })
        }
        throw error
      }
    }
  }
}
