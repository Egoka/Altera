-- Обращения в поддержку и редакцию (docs/spec/20-public/contact.md §4, матрица #117): письмо
-- с /contact и «битая ссылка» со страницы 404 (журнал §20.15). Номер обращения — отдельная
-- последовательность: его видит отправитель, внутренний uuid наружу не отдаётся.

-- CreateEnum
CREATE TYPE "SupportTopic" AS ENUM ('general', 'broken_link', 'refund', 'copyright', 'restore', 'other');

-- CreateTable
CREATE TABLE "support_requests" (
    "id" TEXT NOT NULL,
    "ticketNo" SERIAL NOT NULL,
    "topic" "SupportTopic" NOT NULL,
    "email" TEXT,
    "message" TEXT,
    "path" TEXT,
    "requestId" TEXT,
    "userId" TEXT,
    "locale" "Locale" NOT NULL,
    "createdByRequestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_requests_ticketNo_key" ON "support_requests"("ticketNo");

-- CreateIndex
CREATE INDEX "support_requests_createdAt_idx" ON "support_requests"("createdAt");

-- CreateIndex
CREATE INDEX "support_requests_userId_idx" ON "support_requests"("userId");

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

