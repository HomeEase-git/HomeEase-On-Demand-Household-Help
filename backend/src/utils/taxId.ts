// Philippine BIR Tax Identification Number: 9 digits, or 12 with a branch
// code, conventionally displayed as 000-000-000 or 000-000-000-000.
const TIN_PATTERN = /^\d{3}-?\d{3}-?\d{3}(-?\d{3})?$/;

export function isValidTin(tin: string): boolean {
  return TIN_PATTERN.test(tin.trim());
}

/** Normalizes a TIN to the canonical dashed display format for storage. */
export function normalizeTin(tin: string): string {
  const digits = tin.replace(/\D/g, '');
  return digits.length === 12
    ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9, 12)}`
    : `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
}

/** Masks all but the last 3 digits — used when surfacing a worker's TIN to admins. */
export function maskTin(tin: string): string {
  const digits = tin.replace(/\D/g, '');
  return `•••-•••-${digits.slice(-3)}`;
}
