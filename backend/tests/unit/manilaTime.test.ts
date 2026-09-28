import {
  parseManilaDate,
  manilaMonthKey,
  manilaMonthsIn,
  isManilaQuarter,
  formatManilaPeriod,
  manilaDateKey,
} from '@utils/manilaTime';

describe('Manila tax-period time', () => {
  it('reads a plain date as midnight in Manila (16:00 UTC the day before)', () => {
    expect(parseManilaDate('2026-07-01')?.toISOString()).toBe('2026-06-30T16:00:00.000Z');
  });

  it('keeps full timestamps as they are and rejects nonsense', () => {
    expect(parseManilaDate('2026-07-01T05:00:00.000Z')?.toISOString()).toBe('2026-07-01T05:00:00.000Z');
    expect(parseManilaDate('2026-02-30')).toBeNull();
    expect(parseManilaDate('not a date')).toBeNull();
    expect(parseManilaDate(undefined)).toBeNull();
  });

  it('puts a 3 AM July 1 Manila payment in July, not June', () => {
    const threeAmManila = new Date('2026-06-30T19:00:00.000Z');
    expect(manilaMonthKey(threeAmManila)).toBe('2026-07');
    expect(manilaDateKey(threeAmManila)).toBe('2026-07-01');
  });

  it('lists the months a quarter covers, across a year end too', () => {
    expect(manilaMonthsIn(parseManilaDate('2026-07-01')!, parseManilaDate('2026-10-01')!)).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
    expect(manilaMonthsIn(parseManilaDate('2026-11-01')!, parseManilaDate('2027-02-01')!)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
  });

  it('recognises exactly one calendar quarter', () => {
    const q = (a: string, b: string) => isManilaQuarter(parseManilaDate(a)!, parseManilaDate(b)!);
    expect(q('2026-07-01', '2026-10-01')).toBe(true);
    expect(q('2026-10-01', '2027-01-01')).toBe(true);
    expect(q('2026-08-01', '2026-11-01')).toBe(false); // not quarter-aligned
    expect(q('2026-07-01', '2026-09-30')).toBe(false); // short
    expect(q('2026-01-01', '2027-01-01')).toBe(false); // a year
    // Old UTC-midnight boundaries are not a Manila quarter.
    expect(isManilaQuarter(new Date('2026-07-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'))).toBe(false);
  });

  it('labels a period with its real last day', () => {
    expect(formatManilaPeriod(parseManilaDate('2026-07-01')!, parseManilaDate('2026-10-01')!)).toBe(
      'July 1, 2026 to September 30, 2026'
    );
  });
});
