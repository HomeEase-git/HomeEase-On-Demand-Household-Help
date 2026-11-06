export const MIN_WORKER_AGE = 18;

export interface WorkerAgeRange {
  workerMinAge: number;
  workerMaxAge: number;
}

export function ageInYears(birthDate: Date, on: Date = new Date()): number {
  let age = on.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday =
    on.getUTCMonth() < birthDate.getUTCMonth() ||
    (on.getUTCMonth() === birthDate.getUTCMonth() && on.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age--;
  return age;
}

export function workerAgeError(age: number, range: WorkerAgeRange): string | null {
  const min = Math.max(MIN_WORKER_AGE, range.workerMinAge);
  if (age < min) return `You must be at least ${min} years old to work on HomeEase`;
  if (age > range.workerMaxAge) return `HomeEase accepts workers aged ${min} to ${range.workerMaxAge}`;
  return null;
}

export function parseWorkerBirthDate(value: unknown, range: WorkerAgeRange): { date: Date } | { error: string } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: 'Date of birth must be in YYYY-MM-DD format' };
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { error: 'Date of birth is not a valid date' };
  }
  const age = ageInYears(date);
  if (age > 100) {
    return { error: 'Please check your date of birth' };
  }
  const error = workerAgeError(age, range);
  return error ? { error } : { date };
}
