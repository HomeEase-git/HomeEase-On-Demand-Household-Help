import prisma from '@config/database';
import type { DoleWageReference } from '@/constants/doleWageReference';

export interface PriceBounds {
  minPrice: number;
  maxPrice: number;
}

/**
 * Pure boundary check, split out from the DB lookup below so it's directly
 * unit-testable without touching PricingRule at all.
 */
export function isPriceWithinBounds(price: number, bounds: PriceBounds): boolean {
  return price >= bounds.minPrice && price <= bounds.maxPrice;
}

/**
 * Looks up the PricingRule for (city, serviceType) and validates price
 * against it. No matching rule means no boundary is enforced (city/service
 * combinations without an admin-configured rule are allowed through) —
 * mirrors how PricingRule is optional/admin-curated elsewhere in the app
 * (pricingRuleController has no "every city needs a rule" requirement).
 */
export async function validatePriceWithinPricingRule(
  city: string,
  serviceType: string,
  price: number
): Promise<{ ok: true } | { ok: false; bounds: PriceBounds }> {
  // findFirst + case-insensitive equals, not findUnique on the compound key
  // — city/serviceType here come from whatever a client typed/geocoded, and
  // Prisma's findUnique on a compound key can't take a `mode` filter at all,
  // so a casing mismatch against what an admin typed when creating the rule
  // ("Manila" vs "City of Manila" vs "manila") silently made this whole
  // guardrail a no-op. Matches the same equals+insensitive pattern already
  // used for city/serviceType lookups in matchingService.ts.
  const rule = await prisma.pricingRule.findFirst({
    where: {
      city: { equals: city, mode: 'insensitive' },
      serviceType: { equals: serviceType, mode: 'insensitive' },
    },
  });

  if (!rule) return { ok: true };

  const bounds: PriceBounds = { minPrice: rule.minPrice, maxPrice: rule.maxPrice };
  return isPriceWithinBounds(price, bounds) ? { ok: true } : { ok: false, bounds };
}

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
