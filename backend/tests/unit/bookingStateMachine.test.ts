import { isValidTransition, VALID_TRANSITIONS } from '@services/bookingStateMachine';

describe('booking state machine — valid transitions', () => {
  it.each([
    ['PENDING', 'ACCEPTED'],
    ['PENDING', 'REJECTED'],
    ['PENDING', 'CANCELLED'],
    ['ACCEPTED', 'QUOTE_SUBMITTED'],
    ['ACCEPTED', 'CANCELLED'],
    ['IN_PROGRESS', 'PENDING_COMPLETION'],
    ['IN_PROGRESS', 'CANCELLED'],
    ['QUOTE_SUBMITTED', 'QUOTE_APPROVED'],
    ['QUOTE_SUBMITTED', 'DISPUTED'],
    ['QUOTE_SUBMITTED', 'CANCELLED'],
    ['QUOTE_APPROVED', 'IN_PROGRESS'],
    ['QUOTE_APPROVED', 'ACCEPTED'],
    ['QUOTE_APPROVED', 'CANCELLED'],
    ['QUOTE_SUBMITTED', 'ACCEPTED'],
    ['DISPUTED', 'QUOTE_APPROVED'],
    ['DISPUTED', 'ACCEPTED'],
    ['DISPUTED', 'CANCELLED'],
    ['PENDING_COMPLETION', 'COMPLETED'],
    ['PENDING_COMPLETION', 'CANCELLED'],
  ])('allows %s -> %s', (from, to) => {
    expect(isValidTransition(from, to)).toBe(true);
  });

  it.each([
    ['PENDING', 'IN_PROGRESS'],
    ['PENDING', 'COMPLETED'],
    ['PENDING', 'QUOTE_SUBMITTED'],
    // The job can't start (or finish) before the client approves the quote.
    ['ACCEPTED', 'IN_PROGRESS'],
    ['ACCEPTED', 'COMPLETED'],
    ['ACCEPTED', 'REJECTED'],
    ['IN_PROGRESS', 'QUOTE_SUBMITTED'],
    ['IN_PROGRESS', 'QUOTE_APPROVED'],
    ['IN_PROGRESS', 'PENDING'],
    ['QUOTE_SUBMITTED', 'IN_PROGRESS'],
    ['QUOTE_SUBMITTED', 'PENDING_COMPLETION'],
    ['QUOTE_APPROVED', 'QUOTE_SUBMITTED'],
    ['QUOTE_APPROVED', 'PENDING_COMPLETION'],
    ['QUOTE_APPROVED', 'COMPLETED'],
    ['DISPUTED', 'IN_PROGRESS'],
    ['DISPUTED', 'PENDING_COMPLETION'],
    ['PENDING_COMPLETION', 'QUOTE_APPROVED'],
  ])('rejects %s -> %s', (from, to) => {
    expect(isValidTransition(from, to)).toBe(false);
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
