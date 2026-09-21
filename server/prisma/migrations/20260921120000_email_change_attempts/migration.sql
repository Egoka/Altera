-- Счётчик израсходованных попыток кода смены адреса: по их исчерпании запрос закрывается
-- (docs/spec/30-account/reader/email-change.md §4, §8). Существующие строки начинают с нуля.
ALTER TABLE "email_change_requests" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
