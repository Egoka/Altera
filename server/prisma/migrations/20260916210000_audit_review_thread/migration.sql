-- CreateEnum
CREATE TYPE "ReviewMessageKind" AS ENUM ('rework_request', 'unpublish', 'manual_publish', 'final_reject', 'message', 'ai_decision', 'submitted', 'withdrawn', 'published_auto', 'author_reply');

-- CreateTable: audit_logs (append-only, no UPDATE/DELETE)
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" "Role",
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "diff" JSONB,
    "subject" TEXT,
    "context" TEXT,
    "purpose" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- Immutability: no UPDATE or DELETE on audit_logs
CREATE OR REPLACE FUNCTION prevent_audit_log_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log records are immutable';
END;
$$;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_change();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_change();

-- CreateTable: review_messages
CREATE TABLE "review_messages" (
    "id" TEXT NOT NULL,
    "translationId" TEXT NOT NULL,
    "kind" "ReviewMessageKind" NOT NULL,
    "text" TEXT,
    "recommendations" TEXT,
    "byRole" "Role" NOT NULL,
    "parentId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_messages_translationId_createdAt_idx" ON "review_messages"("translationId", "createdAt");
CREATE INDEX "review_messages_parentId_idx" ON "review_messages"("parentId");

-- AddForeignKey
ALTER TABLE "review_messages" ADD CONSTRAINT "review_messages_translationId_fkey"
    FOREIGN KEY ("translationId") REFERENCES "article_translations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "review_messages" ADD CONSTRAINT "review_messages_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "review_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: review_notes
CREATE TABLE "review_notes" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_notes_revisionId_idx" ON "review_notes"("revisionId");

-- AddForeignKey
ALTER TABLE "review_notes" ADD CONSTRAINT "review_notes_revisionId_fkey"
    FOREIGN KEY ("revisionId") REFERENCES "article_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "review_notes" ADD CONSTRAINT "review_notes_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
