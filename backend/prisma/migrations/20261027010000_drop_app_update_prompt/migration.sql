-- Retired in-app update prompt (fields removed from schema.prisma in d6f1b6e7).
ALTER TABLE "AppSettings" DROP COLUMN IF EXISTS "androidLatestVersion", DROP COLUMN IF EXISTS "androidMinVersion", DROP COLUMN IF EXISTS "androidStoreUrl";
