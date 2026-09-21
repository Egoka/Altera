-- Неизменяемая история backend.error (docs/spec/80-observability/error-collector.md §2 п. 2,
-- реестр событий #81): сбои API, веба и воркеров и отдельный поток ошибок фронта page.error (#64).
-- Запись не редактируется; удаление остаётся только для ретенции (§2 п. 2), вручную — нет.

-- CreateEnum
CREATE TYPE "ErrorStream" AS ENUM ('backend', 'page');

-- CreateTable
CREATE TABLE "backend_error_events" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "stream" "ErrorStream" NOT NULL,
    "service" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "route" TEXT,
    "requestId" TEXT,
    "jobId" TEXT,
    "errorType" TEXT,
    "message" TEXT,
    "stack" TEXT,
    "signature" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backend_error_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backend_error_events_signature_occurredAt_idx" ON "backend_error_events"("signature", "occurredAt");

-- CreateIndex
CREATE INDEX "backend_error_events_stream_occurredAt_idx" ON "backend_error_events"("stream", "occurredAt");

-- CreateIndex
CREATE INDEX "backend_error_events_requestId_idx" ON "backend_error_events"("requestId");

-- Immutability: no UPDATE on backend_error_events
CREATE OR REPLACE FUNCTION prevent_backend_error_event_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'backend_error_events records are immutable';
END;
$$;

CREATE TRIGGER backend_error_events_no_update
  BEFORE UPDATE ON "backend_error_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_backend_error_event_update();
