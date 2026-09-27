// Workers must be adults (RA 9231 on child labour; household work in
// clients' homes). Checked when the worker enters their date of birth,
// before their application can be submitted, and at admin approval.
export const MIN_WORKER_AGE = 18;

/** Whole years between birthDate and `on` (defaults to now). */
export function ageInYears(birthDate: Date, on: Date = new Date()): number {
  let age = on.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday =
    on.getUTCMonth() < birthDate.getUTCMonth() ||
    (on.getUTCMonth() === birthDate.getUTCMonth() && on.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age--;
  return age;
}

/**
 * Parses a YYYY-MM-DD date of birth. Returns the Date, or an error message
 * suitable for the user.
 */
export function parseWorkerBirthDate(value: unknown): { date: Date } | { error: string } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: 'Date of birth must be in YYYY-MM-DD format' };
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { error: 'Date of birth is not a valid date' };
  }
  const age = ageInYears(date);
  if (age < MIN_WORKER_AGE) {
    return { error: `You must be at least ${MIN_WORKER_AGE} years old to work on HomeEase` };
  }
  if (age > 100) {
    return { error: 'Please check your date of birth' };
  }
  return { date };
}
