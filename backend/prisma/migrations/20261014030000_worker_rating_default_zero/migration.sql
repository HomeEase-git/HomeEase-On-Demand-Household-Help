-- New workers start unrated (0) instead of a free 5.0.
ALTER TABLE "WorkerProfile" ALTER COLUMN "rating" SET DEFAULT 0;

-- Workers with no reviews still carry the old 5.0 default.
UPDATE "WorkerProfile" SET "rating" = 0 WHERE "totalReviews" = 0;
