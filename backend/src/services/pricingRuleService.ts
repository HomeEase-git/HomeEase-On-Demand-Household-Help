import prisma from '@config/database';
import { getDoleWageReference } from '@/constants/doleWageReference';

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
  const rule = await prisma.pricingRule.findUnique({
    where: { city_serviceType: { city, serviceType } },
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
 * — flags a minPrice that wouldn't cover even one hour at the city's
 * DOLE-equivalent hourly wage, which is almost always a pricing mistake
 * rather than intent. Blocks unless the caller supplies a non-empty
 * overrideReason, which is surfaced back as an audit-log note rather than
 * stored on PricingRule itself.
 */
export function checkDoleFloor(
  city: string,
  minPrice: number,
  overrideReason: string | undefined
): DoleFloorCheck {
  const ref = getDoleWageReference(city);
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
