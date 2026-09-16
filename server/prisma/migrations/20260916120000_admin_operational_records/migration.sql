-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled', 'stuck');

-- CreateEnum
CREATE TYPE "AiProcessKind" AS ENUM ('check', 'translate', 'profile', 'alt');

-- CreateEnum
CREATE TYPE "AiProcessStatus" AS ENUM ('created', 'started', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "MailDeliveryStatus" AS ENUM ('queued', 'sent', 'bounced', 'failed');

-- CreateEnum
CREATE TYPE "BackendErrorService" AS ENUM ('api', 'web', 'worker');

-- CreateEnum
CREATE TYPE "BackendErrorWorkStatus" AS ENUM ('new', 'in_progress', 'resolved');

-- CreateEnum
CREATE TYPE "LegalTextKind" AS ENUM ('terms', 'privacy', 'content_rules', 'license', 'paid_services', 'refunds', 'about');

-- CreateEnum
CREATE TYPE "LegalTextStatus" AS ENUM ('draft', 'published', 'previous');

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "objectType" TEXT,
    "objectId" TEXT,
    "parameters" JSONB,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_attempts" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorRequestId" TEXT,
    "errorClass" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_processes" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "kind" "AiProcessKind" NOT NULL,
    "status" "AiProcessStatus" NOT NULL DEFAULT 'created',
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "model" TEXT,
    "promptVersion" TEXT,
    "verdict" TEXT,
    "reasons" JSONB,
    "providerErrorClass" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_processes_pkey" PRIMARY KEY ("id")
);

-- Стоимость хранится только в агрегатах по периодам, но не у отдельного AI-процесса.
CREATE TABLE "ai_cost_aggregates" (
    "id" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "bucketEnd" TIMESTAMP(3) NOT NULL,
    "kind" "AiProcessKind" NOT NULL,
    "totalCostMinor" BIGINT NOT NULL,
    "processCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_cost_aggregates_pkey" PRIMARY KEY ("id")
);

-- Сохранённое содержимое не включает одноразовые ссылки, коды и другие секреты.
CREATE TABLE "mail_messages" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "template" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sanitizedBody" TEXT NOT NULL,
    "status" "MailDeliveryStatus" NOT NULL DEFAULT 'queued',
    "objectType" TEXT,
    "objectId" TEXT,
    "provider" TEXT,
    "messageId" TEXT,
    "deliveryErrorClass" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mail_delivery_events" (
    "id" TEXT NOT NULL,
    "mailMessageId" TEXT NOT NULL,
    "status" "MailDeliveryStatus" NOT NULL,
    "providerEventId" TEXT,
    "errorClass" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_delivery_events_pkey" PRIMARY KEY ("id")
);

-- Запись ошибки содержит только ограниченный очищенный технический контекст.
CREATE TABLE "backend_errors" (
    "id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "service" "BackendErrorService" NOT NULL,
    "code" TEXT NOT NULL,
    "errorClass" TEXT,
    "sanitizedMessage" TEXT NOT NULL,
    "route" TEXT,
    "requestMethod" TEXT,
    "requestId" TEXT,
    "sanitizedStack" TEXT,
    "actorRole" "Role",
    "jobId" TEXT,
    "workStatus" "BackendErrorWorkStatus" NOT NULL DEFAULT 'new',
    "assignedActorId" TEXT,
    "assignedActorRole" "Role",
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backend_errors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "backend_error_status_history" (
    "id" TEXT NOT NULL,
    "backendErrorId" TEXT NOT NULL,
    "fromStatus" "BackendErrorWorkStatus",
    "toStatus" "BackendErrorWorkStatus" NOT NULL,
    "changedByActorId" TEXT NOT NULL,
    "changedByActorRole" "Role" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backend_error_status_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_texts" (
    "id" TEXT NOT NULL,
    "kind" "LegalTextKind" NOT NULL,
    "locale" "Locale" NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "LegalTextStatus" NOT NULL DEFAULT 'draft',
    "body" TEXT NOT NULL,
    "summaryOfChanges" TEXT NOT NULL,
    "isMaterial" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "publishedByActorId" TEXT,
    "publishedByRole" "Role",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_texts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_legal_consents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legalTextId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_legal_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_status_availableAt_idx" ON "jobs"("status", "availableAt");
CREATE INDEX "jobs_kind_status_idx" ON "jobs"("kind", "status");
CREATE INDEX "jobs_objectType_objectId_idx" ON "jobs"("objectType", "objectId");
CREATE UNIQUE INDEX "job_attempts_jobId_number_key" ON "job_attempts"("jobId", "number");
CREATE INDEX "job_attempts_status_idx" ON "job_attempts"("status");
CREATE INDEX "ai_processes_kind_status_createdAt_idx" ON "ai_processes"("kind", "status", "createdAt");
CREATE INDEX "ai_processes_objectType_objectId_idx" ON "ai_processes"("objectType", "objectId");
CREATE INDEX "ai_processes_jobId_idx" ON "ai_processes"("jobId");
CREATE UNIQUE INDEX "ai_cost_aggregates_bucketStart_bucketEnd_kind_key" ON "ai_cost_aggregates"("bucketStart", "bucketEnd", "kind");
CREATE INDEX "ai_cost_aggregates_kind_bucketStart_idx" ON "ai_cost_aggregates"("kind", "bucketStart");
CREATE INDEX "mail_messages_status_createdAt_idx" ON "mail_messages"("status", "createdAt");
CREATE INDEX "mail_messages_template_createdAt_idx" ON "mail_messages"("template", "createdAt");
CREATE INDEX "mail_messages_recipientEmail_idx" ON "mail_messages"("recipientEmail");
CREATE INDEX "mail_messages_objectType_objectId_idx" ON "mail_messages"("objectType", "objectId");
CREATE INDEX "mail_messages_jobId_idx" ON "mail_messages"("jobId");
CREATE INDEX "mail_delivery_events_mailMessageId_occurredAt_idx" ON "mail_delivery_events"("mailMessageId", "occurredAt");
CREATE UNIQUE INDEX "backend_errors_signature_key" ON "backend_errors"("signature");
CREATE INDEX "backend_errors_workStatus_lastSeenAt_idx" ON "backend_errors"("workStatus", "lastSeenAt");
CREATE INDEX "backend_errors_service_code_idx" ON "backend_errors"("service", "code");
CREATE INDEX "backend_errors_requestId_idx" ON "backend_errors"("requestId");
CREATE INDEX "backend_errors_jobId_idx" ON "backend_errors"("jobId");
CREATE INDEX "backend_error_status_history_backendErrorId_createdAt_idx" ON "backend_error_status_history"("backendErrorId", "createdAt");
CREATE UNIQUE INDEX "legal_texts_kind_locale_version_key" ON "legal_texts"("kind", "locale", "version");
CREATE INDEX "legal_texts_kind_locale_status_idx" ON "legal_texts"("kind", "locale", "status");
CREATE UNIQUE INDEX "user_legal_consents_userId_legalTextId_key" ON "user_legal_consents"("userId", "legalTextId");
CREATE INDEX "user_legal_consents_legalTextId_acceptedAt_idx" ON "user_legal_consents"("legalTextId", "acceptedAt");

-- AddForeignKey
ALTER TABLE "job_attempts" ADD CONSTRAINT "job_attempts_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_processes" ADD CONSTRAINT "ai_processes_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mail_delivery_events" ADD CONSTRAINT "mail_delivery_events_mailMessageId_fkey" FOREIGN KEY ("mailMessageId") REFERENCES "mail_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "backend_errors" ADD CONSTRAINT "backend_errors_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "backend_error_status_history" ADD CONSTRAINT "backend_error_status_history_backendErrorId_fkey" FOREIGN KEY ("backendErrorId") REFERENCES "backend_errors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_legal_consents" ADD CONSTRAINT "user_legal_consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_legal_consents" ADD CONSTRAINT "user_legal_consents_legalTextId_fkey" FOREIGN KEY ("legalTextId") REFERENCES "legal_texts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
