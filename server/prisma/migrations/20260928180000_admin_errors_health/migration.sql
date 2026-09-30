-- Append-only snapshots of state transitions from GET /health (T-081).
CREATE TABLE "system_health_snapshots" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "backups" JSONB NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_health_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "system_health_snapshots_checkedAt_idx" ON "system_health_snapshots"("checkedAt");

CREATE OR REPLACE FUNCTION prevent_system_health_snapshot_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'system_health_snapshots records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER system_health_snapshots_no_update
  BEFORE UPDATE ON "system_health_snapshots"
  FOR EACH ROW EXECUTE FUNCTION prevent_system_health_snapshot_change();

CREATE TRIGGER system_health_snapshots_no_delete
  BEFORE DELETE ON "system_health_snapshots"
  FOR EACH ROW EXECUTE FUNCTION prevent_system_health_snapshot_change();
