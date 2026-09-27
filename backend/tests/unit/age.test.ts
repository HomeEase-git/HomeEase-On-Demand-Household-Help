import { ageInYears, parseWorkerBirthDate, workerAgeError } from '@utils/age';

const RANGE = { workerMinAge: 18, workerMaxAge: 60 };

function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

describe('ageInYears', () => {
  it('counts a birthday only once it has passed', () => {
    const on = new Date('2026-09-25T00:00:00Z');
    expect(ageInYears(new Date('2008-09-25T00:00:00Z'), on)).toBe(18);
    expect(ageInYears(new Date('2008-09-26T00:00:00Z'), on)).toBe(17);
  });
});

describe('parseWorkerBirthDate', () => {
  it('accepts an age inside the range', () => {
    expect(parseWorkerBirthDate('1990-05-15', RANGE)).toEqual({ date: new Date('1990-05-15T00:00:00Z') });
  });

  it('rejects a minor', () => {
    expect(parseWorkerBirthDate(yearsAgo(16), RANGE)).toEqual({ error: expect.stringMatching(/at least 18/) });
  });

  it('rejects someone over the maximum age', () => {
    expect(parseWorkerBirthDate(yearsAgo(61), RANGE)).toEqual({ error: expect.stringMatching(/18 to 60/) });
  });

  it('never lets the minimum drop below 18', () => {
    expect(workerAgeError(17, { workerMinAge: 16, workerMaxAge: 60 })).toMatch(/at least 18/);
  });

  it('rejects malformed or impossible dates', () => {
    expect(parseWorkerBirthDate('15/05/1990', RANGE)).toHaveProperty('error');
    expect(parseWorkerBirthDate('1990-02-30', RANGE)).toHaveProperty('error');
    expect(parseWorkerBirthDate(19900515, RANGE)).toHaveProperty('error');
  });
});
