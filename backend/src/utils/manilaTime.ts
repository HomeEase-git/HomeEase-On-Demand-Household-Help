/**
 * Tax periods follow the Philippine calendar: a quarter starts at midnight in
 * Manila, not midnight UTC (8 hours later). The Philippines has no daylight
 * saving, so Manila is always UTC+8 and plain arithmetic is exact.
 */

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Midnight Manila time at the start of the given calendar day (month is 1-12). */
export function manilaMidnight(year: number, month: number, day = 1): Date {
  return new Date(Date.UTC(year, month - 1, day) - MANILA_OFFSET_MS);
}

/**
 * Reads a period boundary sent by the admin UI. A plain date ("2026-07-01")
 * means midnight Manila time on that day; a full timestamp is taken as-is.
 * Returns null for anything unparseable.
 */
export function parseManilaDate(value: unknown): Date | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  if (typeof value === 'string') {
    const m = DATE_ONLY.exec(value.trim());
    if (m) {
      const date = manilaMidnight(Number(m[1]), Number(m[2]), Number(m[3]));
      // Reject roll-overs like 2026-02-30.
      return manilaDateKey(date) === value.trim() ? date : null;
    }
  }
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The Manila calendar parts of an instant (month is 1-12). */
export function manilaParts(date: Date) {
  const shifted = new Date(date.getTime() + MANILA_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** "2026-07-01" — the Manila calendar day of an instant. */
export function manilaDateKey(date: Date): string {
  const { year, month, day } = manilaParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "2026-07" — the Manila calendar month of an instant. */
export function manilaMonthKey(date: Date): string {
  return manilaDateKey(date).slice(0, 7);
}

/**
 * The Manila calendar months a [start, end) period covers, in order, as
 * "YYYY-MM" keys — e.g. a Q3 period gives ["2026-07", "2026-08", "2026-09"].
 */
export function manilaMonthsIn(start: Date, end: Date): string[] {
  const months: string[] = [];
  let { year, month } = manilaParts(start);
  for (let cursor = manilaMidnight(year, month); cursor < end; ) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    cursor = manilaMidnight(year, month);
  }
  return months;
}

/** True when [start, end) is exactly one calendar quarter in Manila time. */
export function isManilaQuarter(start: Date, end: Date): boolean {
  const { year, month, day } = manilaParts(start);
  if (day !== 1 || (month - 1) % 3 !== 0) return false;
  if (start.getTime() !== manilaMidnight(year, month).getTime()) return false;
  const endMonth = month + 3 > 12 ? month + 3 - 12 : month + 3;
  const endYear = month + 3 > 12 ? year + 1 : year;
  return end.getTime() === manilaMidnight(endYear, endMonth).getTime();
}

/**
 * Human label for a [start, end) period as the dates it actually covers —
 * the end is exclusive, so Q3 reads "July 1, 2026 to September 30, 2026",
 * not "... to October 1".
 */
export function formatManilaPeriod(start: Date, end: Date, style: 'long' | 'short' = 'long'): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: style === 'long' ? 'long' : 'short',
    day: 'numeric',
  };
  const lastDay = new Date(end.getTime() - 1);
  return `${start.toLocaleDateString('en-PH', opts)} to ${lastDay.toLocaleDateString('en-PH', opts)}`;
}

/** "July 2026" for a "2026-07" key. */
export function formatMonthKey(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return manilaMidnight(year, month).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long' });
}
