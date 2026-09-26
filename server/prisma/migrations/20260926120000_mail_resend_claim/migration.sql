-- T-134: отметка повтора письма из админки (docs/backlog/tasks/T-134-admin-mail-pd-in-list.md §3).
-- Раньше «уже повторено» читалось из audit_logs отдельным запросом перед отправкой, поэтому два
-- параллельных повтора одного письма проходили проверку оба и получатель получал дубль. Колонка
-- делает заявку на повтор условным UPDATE по первичному ключу: победитель гонки один, второй
-- видит занятую отметку.

-- AlterTable
ALTER TABLE "mail_messages" ADD COLUMN     "resentAt" TIMESTAMP(3);

-- Уже выполненные повторы известны по записи аудита job.retry: без переноса они снова стали бы
-- доступны для повтора.
UPDATE "mail_messages" AS m
SET "resentAt" = a."retriedAt"
FROM (
    SELECT "entityId", MIN("createdAt") AS "retriedAt"
    FROM "audit_logs"
    WHERE "action" = 'job.retry' AND "entityType" = 'mailMessage'
    GROUP BY "entityId"
) AS a
WHERE m."id" = a."entityId";
