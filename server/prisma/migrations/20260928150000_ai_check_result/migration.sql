-- Запись результата AI-проверки допустимости (T-048, docs/spec/40-admin/ai-check-criteria.md §5,
-- 40-admin/ai-processes.md §3). Миграция только дополняет существующие таблицы.
--
-- Колонки стоимости у отдельного AI-процесса нет и не появляется: стоимость живёт только в
-- ai_cost_aggregates (журнал §27.4).

-- AlterTable
ALTER TABLE "ai_processes" ADD COLUMN     "adult" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "evidence" JSONB,
ADD COLUMN     "manipulationAttempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revisionId" TEXT;

-- Одна проверка на ревизию: повторного запуска ради другого вердикта нет (журнал #14).
-- NULL в PostgreSQL не конфликтует, поэтому ограничение действует только на записи с ревизией —
-- то есть на проверки статьи, а не на проверки профиля и описания изображения.
-- CreateIndex
CREATE UNIQUE INDEX "ai_processes_objectType_objectId_revisionId_key" ON "ai_processes"("objectType", "objectId", "revisionId");

-- Роль автора записи истории решений становится необязательной: у записи автоматической
-- проверки (kind = 'ai_decision') роли сотрудника нет, решение принимает система (журнал §16.3).
-- AlterTable
ALTER TABLE "review_messages" ALTER COLUMN "byRole" DROP NOT NULL;
