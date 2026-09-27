-- Открытый запрос самостоятельного архивирования аккаунта (docs/spec/30-account/reader/delete-account.md
-- §4, 10-flows/delete-account.md шаги 2–3): письмо с одноразовой ссылкой уходит сразу, а архив
-- выполняет переход по ней. Запрос один на аккаунт — второй отвечает CONFLICT; в базе это
-- уникальный "userId". Хэш токена хранится вместо самого токена, как у ссылок входа.

-- CreateTable
CREATE TABLE "account_archive_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_archive_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_archive_requests_userId_key" ON "account_archive_requests"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "account_archive_requests_tokenHash_key" ON "account_archive_requests"("tokenHash");

-- AddForeignKey
ALTER TABLE "account_archive_requests" ADD CONSTRAINT "account_archive_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
