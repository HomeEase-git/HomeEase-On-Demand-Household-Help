-- Payment: rename in place (preserves any existing values)
ALTER TABLE "Payment" RENAME COLUMN "paymongoSourceId" TO "xenditInvoiceId";
ALTER TABLE "Payment" RENAME COLUMN "paymongoPaymentId" TO "xenditPaymentId";

-- Payout: drop dead PayMongo columns (DROP COLUMN auto-drops the unique
-- index on paymongoTransferId — no separate DROP CONSTRAINT needed).
ALTER TABLE "Payout" DROP COLUMN "paymongoTransferId";
ALTER TABLE "Payout" DROP COLUMN "paymongoTransferStatus";
-- xenditDisbursementId / xenditStatus already exist from an even earlier
-- Xendit-era migration — no DDL needed here, only the schema.prisma comment
-- changed (deprecated -> live).

-- WalletTransaction: rename in place
ALTER TABLE "WalletTransaction" RENAME COLUMN "paymongoCheckoutId" TO "xenditInvoiceId";
