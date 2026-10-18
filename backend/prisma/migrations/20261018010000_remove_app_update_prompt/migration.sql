-- The in-app store-update prompt was dropped; remove its admin-edited settings.
ALTER TABLE "AppSettings" DROP COLUMN "androidLatestVersion",
DROP COLUMN "androidMinVersion",
DROP COLUMN "androidStoreUrl";
