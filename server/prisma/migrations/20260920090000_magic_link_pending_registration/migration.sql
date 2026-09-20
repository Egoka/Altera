-- T-022: токен входа привязывается к адресу, а не к учётной записи.
-- Первый вход создаёт аккаунт при подтверждении ссылки (session-lifecycle.md п. 2),
-- поэтому на момент запроса ссылки пользователя ещё может не быть.

-- Действующие токены выданы по старой схеме и не несут адреса: без него обменять их нельзя.
-- Срок жизни токена — 15 минут, поэтому потеря ограничена одним окном запроса.
DELETE FROM "magic_link_tokens";

ALTER TABLE "magic_link_tokens"
  DROP CONSTRAINT "magic_link_tokens_userId_fkey";
DROP INDEX "magic_link_tokens_userId_key";
ALTER TABLE "magic_link_tokens"
  DROP COLUMN "userId",
  ADD COLUMN "email" TEXT NOT NULL,
  ADD COLUMN "locale" "Locale" NOT NULL DEFAULT 'ru',
  ADD COLUMN "next" TEXT,
  ADD COLUMN "termsVersion" INTEGER,
  ADD COLUMN "privacyVersion" INTEGER;

-- Один действующий токен на адрес: повторный запрос отзывает прежний (login.md §7).
CREATE UNIQUE INDEX "magic_link_tokens_email_key" ON "magic_link_tokens"("email");

-- Ограниченная сессия самостоятельно архивированного аккаунта (session-lifecycle.md п. 7).
ALTER TABLE "sessions"
  ADD COLUMN "limited" BOOLEAN NOT NULL DEFAULT false;
