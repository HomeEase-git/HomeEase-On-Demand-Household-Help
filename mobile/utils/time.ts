// Single source of truth for time representation across the app.
// Enforces a "HH:mm" 24-hour format (e.g., "09:00", "14:30").

export type TimeHHmm = string; // branded-in-spirit: must match /^([01]\d|2[0-3]):[0-5]\d$/

const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidHHmm(t: string): t is TimeHHmm {
  return HHMM_REGEX.test(t);
}

export function toDisplayTime(t: TimeHHmm, locale = undefined): string {
  // Convert "HH:mm" to a localized display like "2:30 PM".
  // If Intl is available, use it; otherwise fall back to manual formatting.
  try {
    const [hh, mm] = t.split(':').map(Number);
    const date = new Date(0, 0, 0, hh, mm, 0);
    // Use toLocaleTimeString for localization; default to en-US-like output.
    return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  } catch (e) {
    return t;
  }
}

export function parseToHHmm(date: Date): TimeHHmm {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const val = `${hh}:${mm}`;
  if (!isValidHHmm(val)) throw new Error('Invalid time generated');
  return val;
}

export function normalizeToHHmm(input: string | Date): TimeHHmm | null {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (isValidHHmm(trimmed)) return trimmed;
    return null;
  }
  return parseToHHmm(input);
}
