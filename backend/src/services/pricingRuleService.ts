import prisma from '@config/database';

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
