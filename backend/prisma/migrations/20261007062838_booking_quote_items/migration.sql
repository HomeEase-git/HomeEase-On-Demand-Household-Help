-- CreateTable
CREATE TABLE "BookingQuoteItem" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "receiptUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "proofOfUseUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingQuoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingQuoteItem_bookingId_idx" ON "BookingQuoteItem"("bookingId");

-- AddForeignKey
ALTER TABLE "BookingQuoteItem" ADD CONSTRAINT "BookingQuoteItem_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
