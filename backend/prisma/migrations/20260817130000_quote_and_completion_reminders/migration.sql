-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "quoteReminderSentAt" TIMESTAMP(3),
ADD COLUMN "completionReminderSentAt" TIMESTAMP(3);
