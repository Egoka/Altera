BEGIN;

CREATE TYPE "MediaKind" AS ENUM ('image');
CREATE TYPE "MediaProcessingStatus" AS ENUM ('uploading', 'queued', 'processing', 'ready', 'failed');
CREATE TYPE "MediaLicense" AS ENUM ('own', 'cc_by', 'cc_by_sa', 'cc_by_nc', 'cc0', 'public_domain', 'permission');

CREATE TABLE "media_assets" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "kind" "MediaKind" NOT NULL DEFAULT 'image',
  "processingStatus" "MediaProcessingStatus" NOT NULL DEFAULT 'uploading',
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "sha256" TEXT NOT NULL,
  "variants" JSONB NOT NULL DEFAULT '[]',
  "focalX" DOUBLE PRECISION,
  "focalY" DOUBLE PRECISION,
  "alt" TEXT,
  "caption" TEXT,
  "attribution" TEXT NOT NULL,
  "license" "MediaLicense" NOT NULL,
  "licenseNote" TEXT,
  "placeholder" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "articles" ADD COLUMN "coverAssetId" TEXT;

CREATE UNIQUE INDEX "media_assets_storageKey_key" ON "media_assets"("storageKey");
CREATE INDEX "media_assets_ownerId_createdAt_idx" ON "media_assets"("ownerId", "createdAt" DESC);
CREATE INDEX "media_assets_sha256_idx" ON "media_assets"("sha256");
CREATE INDEX "media_assets_processingStatus_createdAt_idx" ON "media_assets"("processingStatus", "createdAt");
CREATE INDEX "articles_coverAssetId_idx" ON "articles"("coverAssetId");

ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_avatarAssetId_fkey"
  FOREIGN KEY ("avatarAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_prevAvatarId_fkey"
  FOREIGN KEY ("prevAvatarId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "articles" ADD CONSTRAINT "articles_coverAssetId_fkey"
  FOREIGN KEY ("coverAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
