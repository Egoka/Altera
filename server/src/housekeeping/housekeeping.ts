import { subDays } from "date-fns"
import { Prisma } from "../generated/prisma"
import { RETENTION_POLICY, type RetentionPolicy } from "./retention-policy"

export const HOUSEKEEPING_JOB_KIND = "housekeeping"

interface DeleteManyDelegate {
  deleteMany(args: { where: object }): Promise<{ count: number }>
}

/**
 * Доступ задания к базе сужен до таблиц с ограниченным сроком: таблиц аудита и истории решений
 * в клиенте нет, поэтому задание не может их удалить даже по ошибке в условии.
 */
export interface HousekeepingClient {
  session: DeleteManyDelegate
  magicLinkToken: DeleteManyDelegate
  emailChangeRequest: DeleteManyDelegate
  backendError: DeleteManyDelegate
  backendErrorEvent: DeleteManyDelegate
  $executeRaw(query: Prisma.Sql): Promise<number>
}

export interface HousekeepingResult {
  sessions: number
  magicLinkTokens: number
  emailChangeRequests: number
  autosaveRevisions: number
  backendErrors: number
  errorEvents: number
}

const PAGE_ERROR_EVENT = "page.error"

export async function runHousekeeping(
  client: HousekeepingClient,
  now: Date,
  policy: RetentionPolicy = RETENTION_POLICY
): Promise<HousekeepingResult> {
  const tokenCutoff = subDays(now, policy.oneTimeTokenAfterExpiryDays)

  const sessions = await client.session.deleteMany({
    where: { expiresAt: { lt: subDays(now, policy.sessionAfterExpiryDays) } }
  })
  const magicLinkTokens = await client.magicLinkToken.deleteMany({
    where: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: tokenCutoff } }] }
  })
  const emailChangeRequests = await client.emailChangeRequest.deleteMany({
    where: { expiresAt: { lt: tokenCutoff } }
  })
  const autosaveRevisions = await pruneAutosaveRevisions(client, subDays(now, policy.autosaveRevisionDays))
  // Запись, по которой сотрудник уже менял рабочий статус, хранится бессрочно вместе с историей
  // решений (`retention-and-pd.md`: «рабочие статусы — бессрочно»).
  const backendErrors = await client.backendError.deleteMany({
    where: { lastSeenAt: { lt: subDays(now, policy.backendErrorDays) }, statusHistory: { none: {} } }
  })
  // Неизменяемая история `backend_error_events` (T-089): триггер запрещает только UPDATE,
  // удаление по сроку разрешено. `page.error` хранится короче остальных событий (реестр #64).
  const pageErrorEvents = await client.backendErrorEvent.deleteMany({
    where: { event: PAGE_ERROR_EVENT, occurredAt: { lt: subDays(now, policy.pageErrorEventDays) } }
  })
  const otherErrorEvents = await client.backendErrorEvent.deleteMany({
    where: { event: { not: PAGE_ERROR_EVENT }, occurredAt: { lt: subDays(now, policy.backendErrorDays) } }
  })

  return {
    sessions: sessions.count,
    magicLinkTokens: magicLinkTokens.count,
    emailChangeRequests: emailChangeRequests.count,
    autosaveRevisions,
    backendErrors: backendErrors.count,
    errorEvents: pageErrorEvents.count + otherErrorEvents.count
  }
}

/**
 * Прореживание `autosave`: удаляются автосохранения старше срока, кроме последней ревизии
 * перевода (она — база для проверки конфликта сохранения, ADR-0033) и ревизий, на которые
 * ссылаются перевод, замечания рецензента или восстановленная ревизия.
 */
function pruneAutosaveRevisions(client: HousekeepingClient, cutoff: Date): Promise<number> {
  return client.$executeRaw(Prisma.sql`
    DELETE FROM "article_revisions" AS r
    WHERE r."kind" = 'autosave'
      AND r."createdAt" < ${cutoff}
      AND EXISTS (
        SELECT 1 FROM "article_revisions" AS newer
        WHERE newer."translationId" = r."translationId"
          AND (newer."createdAt" > r."createdAt" OR (newer."createdAt" = r."createdAt" AND newer."id" > r."id"))
      )
      AND NOT EXISTS (SELECT 1 FROM "article_translations" AS t WHERE t."sourceRevisionId" = r."id")
      AND NOT EXISTS (SELECT 1 FROM "review_notes" AS n WHERE n."revisionId" = r."id")
      AND NOT EXISTS (SELECT 1 FROM "article_revisions" AS restored WHERE restored."restoredFromId" = r."id")
  `)
}
