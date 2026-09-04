-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_REMINDER';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "awaitingPaymentSince" TIMESTAMP(3),
ADD COLUMN     "paymentReminderSentAt" TIMESTAMP(3);
