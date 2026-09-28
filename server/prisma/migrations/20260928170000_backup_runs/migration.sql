-- Отметки прогонов резервного копирования (docs/spec/85-media-and-binary/backups.md §5, журнал
-- §29.9): продукт копии не делает, он читает возраст последней успешной копии базы и медиа для
-- состояния системы и оповещения о просрочке (docs/spec/80-observability/health-and-alerts.md п. 1).

-- CreateEnum
CREATE TYPE "BackupKind" AS ENUM ('database', 'media');

-- CreateEnum
CREATE TYPE "BackupRunStatus" AS ENUM ('succeeded', 'failed');

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" TEXT NOT NULL,
    "kind" "BackupKind" NOT NULL,
    "status" "BackupRunStatus" NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_runs_kind_status_completedAt_idx" ON "backup_runs"("kind", "status", "completedAt");
