import type { DoleWageReference } from '@/constants/doleWageReference';

export type DoleFloorCheck =
  | { blocked: true; message: string }
  | { blocked: false; note: string | null };

export function checkDoleFloor(
  ref: DoleWageReference | null,
  minPrice: number,
  overrideReason: string | undefined
): DoleFloorCheck {
  if (!ref || minPrice >= ref.hourlyWage) {
    return { blocked: false, note: null };
  }
  if (!overrideReason?.trim()) {
    return {
      blocked: true,
      message: `Min price ₱${minPrice} is below the DOLE ${ref.label} hourly wage floor (₱${ref.hourlyWage}/hr, ${ref.wageOrder}). Provide an override reason to save it anyway.`,
    };
  }
  return {
    blocked: false,
    note: `Saved below DOLE ${ref.label} floor (₱${ref.hourlyWage}/hr) — override reason: ${overrideReason.trim()}`,
  };
}
