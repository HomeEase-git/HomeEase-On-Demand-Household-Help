/**
 * Booking status transition map — pure, no I/O, so it's shared between the
 * controller (enforcement) and tests (verification) without pulling in
 * Prisma/Redis/Supabase.
 *
 * Schema BookingStatus values:
 *   PENDING | ACCEPTED | REJECTED | IN_PROGRESS |
 *   QUOTE_SUBMITTED | QUOTE_APPROVED | DISPUTED | PENDING_COMPLETION |
 *   AWAITING_PAYMENT | COMPLETED | CANCELLED
 *
 * NOTE: DECLINED and QUOTE_DISPUTED do not exist in the schema.
 *   - Use REJECTED in place of DECLINED.
 *   - Use DISPUTED in place of QUOTE_DISPUTED.
 *
 * PENDING_COMPLETION: worker has submitted a completion photo and is
 * awaiting the client's confirmation before the booking is finalized.
 *
 * AWAITING_PAYMENT: client confirmed the finished job on a GCash/Maya
 * booking; a Xendit invoice for the full final total is outstanding. The
 * invoice-paid webhook moves it to COMPLETED. CASH bookings skip this state
 * (confirmation finalizes them straight to COMPLETED).
 */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  // REJECTED is a PENDING-only outcome (see bookingController.declineBooking,
  // which hard-guards to that status) — a worker backing out after accepting
  // goes through CANCELLED (bookingController.cancelBooking) instead, which
  // is what actually charges/refunds the accept-time admin fee correctly.
  // Flow: the worker arrives (checked in, status stays ACCEPTED), diagnoses
  // the job and quotes it (QUOTE_SUBMITTED), the client approves
  // (QUOTE_APPROVED), and only then does the worker start the job
  // (IN_PROGRESS) — the client sees the price before any work begins.
  ACCEPTED: ['QUOTE_SUBMITTED', 'CANCELLED'],
  IN_PROGRESS: ['PENDING_COMPLETION', 'CANCELLED'],
  // ACCEPTED: the client refused the quote and the worker revises it.
  QUOTE_SUBMITTED: ['QUOTE_APPROVED', 'DISPUTED', 'ACCEPTED', 'CANCELLED'],
  // IN_PROGRESS: the worker starts the job. ACCEPTED: the worker reopens an
  // approved quote to edit its items before starting
  // (bookingController.reopenQuote); the client must approve the new total.
  QUOTE_APPROVED: ['IN_PROGRESS', 'ACCEPTED', 'CANCELLED'],
  // ACCEPTED (arrived, not yet quoted) is the restart point for a dispute
  // resolved via REQUEST_NEW_QUOTE — the worker resubmits through the normal
  // submitQuote endpoint from there (see adminDisputeController.resolveDispute).
  DISPUTED: ['QUOTE_APPROVED', 'ACCEPTED', 'AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED'],
  PENDING_COMPLETION: ['AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED'],
  AWAITING_PAYMENT: ['COMPLETED', 'DISPUTED', 'CANCELLED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

export const isValidTransition = (currentStatus: string, newStatus: string): boolean => {
  return VALID_TRANSITIONS[currentStatus]?.includes(newStatus) ?? false;
};
