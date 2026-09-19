CREATE TYPE "PermissionExceptionKind" AS ENUM ('grant', 'deny');

CREATE TABLE "permission_exceptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "permission" TEXT NOT NULL,
    "kind" "PermissionExceptionKind" NOT NULL,
    "grantedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "expiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permission_exceptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "permission_exceptions_userId_role_permission_idx"
ON "permission_exceptions"("userId", "role", "permission");
CREATE INDEX "permission_exceptions_endsAt_expiredAt_idx"
ON "permission_exceptions"("endsAt", "expiredAt");

ALTER TABLE "permission_exceptions" ADD CONSTRAINT "permission_exceptions_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "permission_exceptions" ADD CONSTRAINT "permission_exceptions_grantedById_fkey"
FOREIGN KEY ("grantedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "permission_exceptions" ADD CONSTRAINT "permission_exceptions_revokedById_fkey"
FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
