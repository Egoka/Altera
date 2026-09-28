-- Automatic reopenings are system transitions, not staff actions. Keep the actor id while
-- allowing the role to be absent instead of attributing the transition to a fictitious admin.
ALTER TABLE "backend_error_status_history"
  ALTER COLUMN "changedByActorRole" DROP NOT NULL;
