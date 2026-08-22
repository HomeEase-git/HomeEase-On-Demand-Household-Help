-- Admin-configurable category icon (Ionicons outline name, curated set —
-- see backend/src/constants/serviceIcons.ts). Nullable: null means mobile
-- falls back to its static name-based guess (utils/categoryIcons.ts).
ALTER TABLE "ServiceType" ADD COLUMN "icon" TEXT;
