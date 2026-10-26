import { isValidTransition, VALID_TRANSITIONS } from '@services/bookingStateMachine';

describe('booking state machine — valid transitions', () => {
  it.each([
    ['PENDING', 'ACCEPTED'],
    ['PENDING', 'REJECTED'],
    ['PENDING', 'CANCELLED'],
    ['ACCEPTED', 'IN_PROGRESS'],
    ['ACCEPTED', 'CANCELLED'],
    ['IN_PROGRESS', 'PENDING_COMPLETION'],
    ['IN_PROGRESS', 'CANCELLED'],
    // The invoice is sent: cash waits for "Cash received", GCash/Maya is billed.
    ['PENDING_COMPLETION', 'COMPLETED'],
    ['PENDING_COMPLETION', 'AWAITING_PAYMENT'],
    ['PENDING_COMPLETION', 'CANCELLED'],
    ['AWAITING_PAYMENT', 'COMPLETED'],
    // The client reports the invoice before paying.
    ['PENDING_COMPLETION', 'DISPUTED'],
    ['AWAITING_PAYMENT', 'DISPUTED'],
    // An admin keeps or adjusts the invoice, or cancels.
    ['DISPUTED', 'PENDING_COMPLETION'],
    ['DISPUTED', 'AWAITING_PAYMENT'],
    ['DISPUTED', 'CANCELLED'],
    // Retired quote statuses can only be cancelled.
    ['QUOTE_SUBMITTED', 'CANCELLED'],
    ['QUOTE_APPROVED', 'CANCELLED'],
  ])('allows %s -> %s', (from, to) => {
    expect(isValidTransition(from, to)).toBe(true);
  });

  it.each([
    ['PENDING', 'IN_PROGRESS'],
    ['PENDING', 'COMPLETED'],
    ['PENDING', 'QUOTE_SUBMITTED'],
    ['ACCEPTED', 'COMPLETED'],
    ['ACCEPTED', 'REJECTED'],
    ['ACCEPTED', 'QUOTE_SUBMITTED'],
    ['IN_PROGRESS', 'QUOTE_SUBMITTED'],
    ['IN_PROGRESS', 'COMPLETED'],
    ['IN_PROGRESS', 'DISPUTED'],
    ['IN_PROGRESS', 'PENDING'],
    ['QUOTE_SUBMITTED', 'QUOTE_APPROVED'],
    ['QUOTE_APPROVED', 'IN_PROGRESS'],
    ['DISPUTED', 'IN_PROGRESS'],
    ['DISPUTED', 'QUOTE_APPROVED'],
    ['AWAITING_PAYMENT', 'PENDING_COMPLETION'],
  ])('rejects %s -> %s', (from, to) => {
    expect(isValidTransition(from, to)).toBe(false);
  });

  it('never moves a booking into a retired quote status', () => {
    for (const targets of Object.values(VALID_TRANSITIONS)) {
      expect(targets).not.toContain('QUOTE_SUBMITTED');
      expect(targets).not.toContain('QUOTE_APPROVED');
    }
  });

  it('treats every terminal status as a dead end', () => {
    for (const terminal of ['COMPLETED', 'REJECTED', 'CANCELLED']) {
      expect(VALID_TRANSITIONS[terminal]).toEqual([]);
      for (const candidate of Object.keys(VALID_TRANSITIONS)) {
        expect(isValidTransition(terminal, candidate)).toBe(false);
      }
    }
  });

  it('rejects transitions from/to unknown statuses', () => {
    expect(isValidTransition('NOT_A_STATUS', 'ACCEPTED')).toBe(false);
    expect(isValidTransition('PENDING', 'NOT_A_STATUS')).toBe(false);
  });

  it('never allows a status to transition to itself', () => {
    for (const [status, targets] of Object.entries(VALID_TRANSITIONS)) {
      expect(targets).not.toContain(status);
    }
  });
});
