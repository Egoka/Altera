-- Категория причины административной блокировки и короткое объяснение для пользователя
-- (журнал §38 п. 1, §26.9; `docs/spec/40-admin/users.md` §5, `docs/spec/10-flows/archive-account.md` §3).
-- Внутренняя причина остаётся в существующем "archiveReason": она видна только в аудите.
-- Колонки допускают NULL: самостоятельный архив (`archiveMode = self`) категории не имеет, а
-- сообщение пользователю сотрудник добавляет по желанию.

-- CreateEnum
CREATE TYPE "AccountArchiveReasonCategory" AS ENUM ('rules_violation', 'spam_and_manipulation', 'law_or_rights_violation', 'security_threat');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "archivePublicMessage" TEXT,
ADD COLUMN     "archiveReasonCategory" "AccountArchiveReasonCategory";
