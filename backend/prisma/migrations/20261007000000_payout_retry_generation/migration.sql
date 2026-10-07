-- Bumped by each admin retry of a FAILED payout, so the resend uses a fresh
-- Xendit Idempotency-key instead of replaying the failed attempt's key.
-- Additive with a default: safe for instances still running the old code.
ALTER TABLE "Payout" ADD COLUMN "retryGeneration" INTEGER NOT NULL DEFAULT 0;
