import { isValidTransition, VALID_TRANSITIONS } from '@services/bookingStateMachine';

describe('booking state machine — valid transitions', () => {
  it.each([
    ['PENDING', 'ACCEPTED'],
    ['PENDING', 'REJECTED'],
    ['PENDING', 'CANCELLED'],
    ['ACCEPTED', 'IN_PROGRESS'],
    ['ACCEPTED', 'CANCELLED'],
    ['ACCEPTED', 'REJECTED'],
    ['IN_PROGRESS', 'QUOTE_SUBMITTED'],
    ['IN_PROGRESS', 'CANCELLED'],
    ['QUOTE_SUBMITTED', 'QUOTE_APPROVED'],
    ['QUOTE_SUBMITTED', 'DISPUTED'],
    ['QUOTE_SUBMITTED', 'CANCELLED'],
    ['QUOTE_APPROVED', 'PENDING_COMPLETION'],
    ['QUOTE_APPROVED', 'CANCELLED'],
    ['DISPUTED', 'QUOTE_APPROVED'],
    ['DISPUTED', 'IN_PROGRESS'],
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
    ['ACCEPTED', 'QUOTE_SUBMITTED'],
    ['ACCEPTED', 'COMPLETED'],
    ['IN_PROGRESS', 'QUOTE_APPROVED'],
    ['IN_PROGRESS', 'PENDING'],
    ['QUOTE_SUBMITTED', 'PENDING_COMPLETION'],
    ['QUOTE_APPROVED', 'QUOTE_SUBMITTED'],
    ['QUOTE_APPROVED', 'COMPLETED'],
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
