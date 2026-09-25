import { ageInYears, parseWorkerBirthDate } from '@utils/age';

describe('ageInYears', () => {
  it('counts a birthday only once it has passed', () => {
    const on = new Date('2026-09-25T00:00:00Z');
    expect(ageInYears(new Date('2008-09-25T00:00:00Z'), on)).toBe(18);
    expect(ageInYears(new Date('2008-09-26T00:00:00Z'), on)).toBe(17);
  });
});

describe('parseWorkerBirthDate', () => {
  it('accepts an adult date of birth', () => {
    expect(parseWorkerBirthDate('1990-05-15')).toEqual({ date: new Date('1990-05-15T00:00:00Z') });
  });

  it('rejects a minor', () => {
    const minor = new Date();
    minor.setUTCFullYear(minor.getUTCFullYear() - 16);
    expect(parseWorkerBirthDate(minor.toISOString().slice(0, 10))).toEqual({
      error: expect.stringMatching(/at least 18/),
    });
  });

  it('rejects malformed or impossible dates', () => {
    expect(parseWorkerBirthDate('15/05/1990')).toHaveProperty('error');
    expect(parseWorkerBirthDate('1990-02-30')).toHaveProperty('error');
    expect(parseWorkerBirthDate(19900515)).toHaveProperty('error');
  });
});
