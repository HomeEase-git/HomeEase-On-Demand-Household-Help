import type { DoleWageReference } from '@/constants/doleWageReference';

// City price rules (PricingRule) were retired with admin-fixed pricing
// (2026-09-27): a job's price only changes with add-ons, distance, the
// expertise tier, units and a same-day rush fee, so there's nothing left for
// a per-city min/max to guard. Only the DOLE wage-floor check remains.

export type DoleFloorCheck =
  | { blocked: true; message: string }
  | { blocked: false; note: string | null };

/**
 * Soft guardrail, not a legal wage floor (see constants/doleWageReference.ts)
 * — flags a minPrice that wouldn't cover even one hour at the given DOLE-
 * equivalent hourly wage, which is almost always a pricing mistake rather
 * than intent. Blocks unless the caller supplies a non-empty overrideReason,
 * which is surfaced back as an audit-log note rather than stored anywhere
 * on the priced record itself. Takes an already-resolved reference (or
 * null to skip the check) rather than a city, so callers with no city
 * dimension at all (ServiceTask.minPrice, checked against the highest
 * region-wide floor via getHighestDoleWageReference) can reuse this too.
 */
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
