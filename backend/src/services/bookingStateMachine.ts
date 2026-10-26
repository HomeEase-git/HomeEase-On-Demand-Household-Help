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
 * PENDING_COMPLETION: the worker finished and sent the invoice (the job price
 * plus any parts and extra work they added, see
 * bookingController.completeBooking). A CASH booking waits here until the
 * worker taps "Cash received" (markCashReceived), which settles it to
 * COMPLETED. A GCash/Maya booking moves straight on to AWAITING_PAYMENT; it
 * only rests here if raising the Xendit invoice failed (the client's
 * "Pay now" retries it).
 *
 * AWAITING_PAYMENT: a Xendit invoice for the full total is outstanding on a
 * GCash/Maya booking. The invoice-paid webhook moves it to COMPLETED.
 *
 * DISPUTED: the client reported the invoice before paying (reportInvoice).
 * An admin keeps it or removes the worker's added lines, which puts it back
 * to PENDING_COMPLETION (cash) or AWAITING_PAYMENT (GCash/Maya), or cancels it.
 *
 * QUOTE_SUBMITTED / QUOTE_APPROVED are retired (the quote became the invoice
 * after the job). No booking is in them any more; they can only be cancelled.
 */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  // REJECTED is a PENDING-only outcome (see bookingController.declineBooking,
  // which hard-guards to that status) — a worker backing out after accepting
  // goes through CANCELLED (bookingController.cancelBooking) instead.
  // The worker arrives (checked in, status stays ACCEPTED) and starts.
  ACCEPTED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['PENDING_COMPLETION', 'CANCELLED'],
  QUOTE_SUBMITTED: ['CANCELLED'],
  QUOTE_APPROVED: ['CANCELLED'],
  DISPUTED: ['PENDING_COMPLETION', 'AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED'],
  PENDING_COMPLETION: ['AWAITING_PAYMENT', 'COMPLETED', 'DISPUTED', 'CANCELLED'],
  AWAITING_PAYMENT: ['COMPLETED', 'DISPUTED', 'CANCELLED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

export const isValidTransition = (currentStatus: string, newStatus: string): boolean => {
  return VALID_TRANSITIONS[currentStatus]?.includes(newStatus) ?? false;
};
