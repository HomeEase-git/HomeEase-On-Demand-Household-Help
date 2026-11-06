const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function manilaMidnight(year: number, month: number, day = 1): Date {
  return new Date(Date.UTC(year, month - 1, day) - MANILA_OFFSET_MS);
}

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

export function manilaParts(date: Date) {
  const shifted = new Date(date.getTime() + MANILA_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

export function manilaDateKey(date: Date): string {
  const { year, month, day } = manilaParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function manilaMonthKey(date: Date): string {
  return manilaDateKey(date).slice(0, 7);
}

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

export function manilaQuarterLabel(date: Date): string {
  const { year, month } = manilaParts(date);
  return `Q${Math.ceil(month / 3)} ${year}`;
}

export function isManilaQuarter(start: Date, end: Date): boolean {
  const { year, month, day } = manilaParts(start);
  if (day !== 1 || (month - 1) % 3 !== 0) return false;
  if (start.getTime() !== manilaMidnight(year, month).getTime()) return false;
  const endMonth = month + 3 > 12 ? month + 3 - 12 : month + 3;
  const endYear = month + 3 > 12 ? year + 1 : year;
  return end.getTime() === manilaMidnight(endYear, endMonth).getTime();
}

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
