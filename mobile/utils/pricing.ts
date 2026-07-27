/**
 * Pricing Utility
 * Handles all price calculations for bookings including base price, duration,
 * add-ons, taxes, commissions, and tips.
 */

// Mock pricing rates - these can be replaced with API calls later
export const PRICING_CONFIG = {
  TAX_RATE: 0.12, // 12% tax
  COMMISSION_RATE: 0.1, // 10% platform commission
  DURATION_MULTIPLIER: 1.5, // Price multiplier per additional hour
};

/**
 * Service rate per hour for different categories
 * Used as base hourly rate
 */
export const SERVICE_BASE_RATES: Record<string, number> = {
  plumbing: 250,
  electrical: 300,
  aircon: 350,
  cleaning: 200,
  carpentry: 280,
  painting: 220,
  gardening: 180,
  appliance: 240,
};

/**
 * Price breakdown object structure
 */
export interface PriceBreakdown {
  basePrice: number; // Selected task base price
  durationHours: number; // Duration in hours
  durationCost: number; // Additional cost for duration
  addOnsTotal: number; // Total add-ons cost
  subtotal: number; // basePrice + durationCost + addOnsTotal
  tax: number; // Tax amount (12% of subtotal)
  commission: number; // Platform commission (10% of subtotal)
  tip: number; // Optional tip amount
  total: number; // Final total including all fees
}

/**
 * Calculate complete price breakdown for a booking
 *
 * @param basePrice - Task base price
 * @param durationHours - Service duration in hours
 * @param addOnsTotal - Total cost of selected add-ons
 * @param tipAmount - Optional tip amount
 * @returns Complete price breakdown
 */
export function calculatePriceBreakdown(
  basePrice: number,
  durationHours: number = 1,
  addOnsTotal: number = 0,
  tipAmount: number = 0,
): PriceBreakdown {
  // Calculate additional cost for duration beyond first hour
  const durationCost =
    durationHours > 1
      ? basePrice * (durationHours - 1) * PRICING_CONFIG.DURATION_MULTIPLIER
      : 0;

  const subtotal = basePrice + durationCost + addOnsTotal;
  const tax = Math.round(subtotal * PRICING_CONFIG.TAX_RATE * 100) / 100;
  const commission = Math.round(subtotal * PRICING_CONFIG.COMMISSION_RATE * 100) / 100;
  const total = Math.round((subtotal + tax + commission + tipAmount) * 100) / 100;

  return {
    basePrice,
    durationHours,
    durationCost,
    addOnsTotal,
    subtotal,
    tax,
    commission,
    tip: tipAmount,
    total,
  };
}

/**
 * Format currency for display
 */
export function formatPrice(amount: number): string {
  return `₱${amount.toFixed(2)}`;
}

/**
 * Calculate tip suggestions based on subtotal
 */
export function getTipSuggestions(subtotal: number): number[] {
  const percentage10 = Math.round(subtotal * 0.1);
  const percentage15 = Math.round(subtotal * 0.15);
  const percentage20 = Math.round(subtotal * 0.2);

  return [percentage10, percentage15, percentage20];
}

/**
 * Get service base rate
 */
export function getServiceBaseRate(category: string): number {
  const normalized = category.toLowerCase();
  return SERVICE_BASE_RATES[normalized] || 250;
}

/**
 * Validate if custom tip is reasonable (max 50% of subtotal)
 */
export function isValidTipAmount(tip: number, subtotal: number): boolean {
  return tip >= 0 && tip <= subtotal * 0.5;
}
