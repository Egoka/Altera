-- Счётчики корзин лимитов частоты для режима без Redis (docs/spec/50-access/rate-limits.md §2 п. 13,
-- ADR-0019). Персональных данных таблица не хранит: "key" — HMAC адреса, e-mail или аккаунта.
CREATE TABLE "rate_limit_counters" (
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY ("bucket","key")
);

-- Очистка закрытых окон идёт по сроку: расписание API удаляет строки с истёкшим "expiresAt".
CREATE INDEX "rate_limit_counters_expiresAt_idx" ON "rate_limit_counters"("expiresAt");
