import { monthRange } from '../../src/controllers/adminAnalyticsController';

describe('monthRange (Manila calendar months)', () => {
  it('starts and ends at Manila midnight', () => {
    const r = monthRange('2026-10')!;
    expect(r.start.toISOString()).toBe('2026-09-30T16:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-31T16:00:00.000Z');
    expect(r.days).toBe(31);
  });

  it('knows month lengths, including leap-year February', () => {
    expect(monthRange('2026-02')!.days).toBe(28);
    expect(monthRange('2028-02')!.days).toBe(29);
    expect(monthRange('2026-12')!.days).toBe(31);
  });

  it('rejects anything that is not YYYY-MM', () => {
    for (const bad of ['2026-13', '2026-00', '26-10', '2026-1', '', undefined, 5, '2026-10-01']) {
      expect(monthRange(bad)).toBeNull();
    }
  });
});
