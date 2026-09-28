-- Отметка ответа на обращение в поддержку (журнал §37 п. 2, 13): раздел админки «Обращения»
-- фиксирует факт ответа, а владелец аккаунта видит статус «принято / отвечено» в кабинете.
-- Статус выводится из "answeredAt", отдельной колонки статуса нет. Сотрудник, снятый с роли,
-- архивируется (журнал §37 п. 8), но запись об ответе остаётся: FK обнуляется, а не каскадит.

-- AlterTable
ALTER TABLE "support_requests" ADD COLUMN     "answeredAt" TIMESTAMP(3),
ADD COLUMN     "answeredById" TEXT;

-- CreateIndex
CREATE INDEX "support_requests_answeredAt_idx" ON "support_requests"("answeredAt");

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
