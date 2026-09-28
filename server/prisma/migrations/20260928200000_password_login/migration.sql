-- Вход по паролю как второй равный способ (журнал §34 п. 6–8, T-115): хэш пароля, отметка
-- подтверждения адреса и одноразовые токены подтверждения и сброса.

-- CreateEnum
CREATE TYPE "PasswordTokenPurpose" AS ENUM ('email_confirm', 'password_reset');

-- AlterTable
ALTER TABLE "users"
    ADD COLUMN "passwordHash" TEXT,
    ADD COLUMN "passwordUpdatedAt" TIMESTAMP(3),
    ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- Все записи до этой миграции заведены подтверждением ссылки входа или созданы администратором
-- и пароля не имеют: их адрес считается подтверждённым на момент создания, иначе вход по ссылке
-- потребовал бы повторного подтверждения без причины.
UPDATE "users" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;

-- CreateTable
CREATE TABLE "password_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" "PasswordTokenPurpose" NOT NULL,
    "locale" "Locale" NOT NULL DEFAULT 'ru',
    "next" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_tokens_tokenHash_key" ON "password_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "password_tokens_email_purpose_key" ON "password_tokens"("email", "purpose");
