/**
 * Pricing utilities for commission, tax, and payout calculations
 * This mirrors the logic in mobile/utils/pricing.ts to ensure both sides agree
 */
import { COMMISSION_RATE, WITHHOLDING_TAX_RATE } from '@config/pricing';
import { roundToCentavo } from '@utils/money';

export interface PriceBreakdown {
  subtotal: number;
  commissionAmount: number;
  commissionPercentage: number;
  withholdingTaxAmount: number;
  withholdingTaxPercentage: number;
  platformFee: number;
  tip: number;
  total: number;
  workerPayout: number;
  platformProfit: number;
}

/**
 * Platform commission percentage (takes a cut of each transaction)
 */
const COMMISSION_PERCENTAGE = COMMISSION_RATE * 100; // Convert to percentage

/**
 * Withholding tax percentage for workers (tax compliance)
 */
const WITHHOLDING_TAX_PERCENTAGE = WITHHOLDING_TAX_RATE * 100; // Convert to percentage

/**
 * Calculate the commission amount
 * Commission is calculated on the subtotal (labor + materials)
 */
export const calculateCommission = (subtotal: number, commissionRate: number = COMMISSION_RATE): number => {
  return roundToCentavo(subtotal * commissionRate);
};

/**
 * Calculate withholding tax amount
 * Tax is calculated on the subtotal after commission is deducted
 */
export const calculateWithholdingTax = (
  subtotal: number,
  commissionRate: number = COMMISSION_RATE,
  withholdingTaxRate: number = WITHHOLDING_TAX_RATE
): number => {
  const afterCommission = subtotal - calculateCommission(subtotal, commissionRate);
  return roundToCentavo(afterCommission * withholdingTaxRate);
};

/**
 * Calculate worker payout
 * Worker receives: subtotal - commission - tax + tip
 */
export const calculateWorkerPayout = (
  subtotal: number,
  tip: number = 0,
  commissionRate: number = COMMISSION_RATE,
  withholdingTaxRate: number = WITHHOLDING_TAX_RATE
): number => {
  const commission = calculateCommission(subtotal, commissionRate);
  const tax = calculateWithholdingTax(subtotal, commissionRate, withholdingTaxRate);
  const payout = subtotal - commission - tax + tip;
  return roundToCentavo(payout);
};

/**
 * Calculate platform profit
 * Platform keeps: commission + (tax goes to government, but we collect it)
 */
export const calculatePlatformProfit = (subtotal: number, _tip: number = 0): number => {
  const commission = calculateCommission(subtotal);
  // Note: Withholding tax is collected but remitted to government — not platform profit
  return roundToCentavo(commission);
};

/**
 * Get complete price breakdown
 * Used in responses to show transparent pricing to client and worker
 */
export const getPriceBreakdown = (
  subtotal: number,
  tip: number = 0,
  platformFee: number = 0
): PriceBreakdown => {
  const commission = calculateCommission(subtotal);
  const tax = calculateWithholdingTax(subtotal);
  const workerPayout = calculateWorkerPayout(subtotal, tip);
  const platformProfit = calculatePlatformProfit(subtotal, tip);
  const total = subtotal + tip + platformFee;
  
  return {
    subtotal: roundToCentavo(subtotal),
    commissionAmount: commission,
    commissionPercentage: COMMISSION_PERCENTAGE,
    withholdingTaxAmount: tax,
    withholdingTaxPercentage: WITHHOLDING_TAX_PERCENTAGE,
    platformFee: roundToCentavo(platformFee),
    tip: roundToCentavo(tip),
    total: roundToCentavo(total),
    workerPayout: workerPayout,
    platformProfit: platformProfit,
  };
};

// Statutory rate, not a business policy knob like commissionRate — kept as a
// code constant rather than an AppSettings field. Applied to `subtotal` only
// (service price + add-ons + mandatory fees, all already rolled into
// estimatedPrice/laborCost+materialsCost by the time it reaches this
// function) — a voluntary tip is explicitly NOT part of the VAT base, per
// NIRC's gross-receipts definition, and is added on afterward instead.
export const VAT_RATE = 0.12;

/**
 * Single source of truth for a booking's final billable total, used at the
 * pay-after-completion step (bookingController.completeBooking locks it in,
 * confirmCompletion / the invoice webhook / auto-settle all read it).
 *
 * subtotal = (approved quote: labor + materials) OR (no quote: the estimate)
 *            + priced add-ons
 * vatAmount = subtotal × vatRate, only when vatApplicable (worker is
 *             VAT-registered) — read from the booking's own frozen snapshot
 *             (see Booking.vatApplicable/vatRate), never re-derived from the
 *             worker's live status, so a mid-job VAT-registration change
 *             can't shift a price the client already agreed to.
 * totalAmount = subtotal + vatAmount + tip — tip stays outside the VAT base.
 *
 * Add-ons are frozen once a booking reaches PENDING_COMPLETION (see
 * bookingController.addAddon), so this is stable from that point on.
 */
export interface BookingFinalTotalInput {
  estimatedPrice: number;
  laborCost?: number | null;
  materialsCost?: number | null;
  tip?: number | null;
  addOns?: Array<{ price: number }> | null;
  vatApplicable?: boolean | null;
  vatRate?: number | null;
}

export const computeBookingFinalTotal = (
  booking: BookingFinalTotalInput
): { subtotal: number; tip: number; vatAmount: number; totalAmount: number } => {
  const addOnsTotal = (booking.addOns ?? []).reduce(
    (sum, a) => sum + (typeof a.price === 'number' ? a.price : 0),
    0
  );
  const hasQuote = booking.laborCost != null && booking.materialsCost != null;
  const base = hasQuote
    ? (booking.laborCost ?? 0) + (booking.materialsCost ?? 0)
    : booking.estimatedPrice;
  const subtotal = roundToCentavo(base + addOnsTotal);
  const tip = roundToCentavo(booking.tip ?? 0);
  const vatAmount = booking.vatApplicable
    ? roundToCentavo(subtotal * (booking.vatRate ?? VAT_RATE))
    : 0;
  const totalAmount = roundToCentavo(subtotal + vatAmount + tip);
  return { subtotal, tip, vatAmount, totalAmount };
};

/**
 * Validate price breakdown integrity
 * Ensures: subtotal + tip + platformFee = total AND workerPayout + commission + tax = subtotal
 */
export const validatePriceBreakdown = (breakdown: PriceBreakdown): boolean => {
  const totalCheck = breakdown.subtotal + breakdown.tip + breakdown.platformFee;
  const payoutCheck = breakdown.workerPayout + breakdown.commissionAmount + breakdown.withholdingTaxAmount;
  
  // Allow small floating-point rounding errors
  const epsilon = 0.01;
  return (
    Math.abs(totalCheck - breakdown.total) < epsilon &&
    Math.abs(payoutCheck - breakdown.subtotal) < epsilon
  );
};

/**
 * Format currency for display (Philippine Peso)
 */
export const formatPrice = (amount: number): string => {
  return `₱${roundToCentavo(amount).toFixed(2)}`;
};

/**
 * Single source of truth for turning a category/task base price into an
 * estimate — used by both bookingController.createBooking (the
 * authoritative price at booking time) and workerController.searchWorkers
 * (the per-worker preview shown in Step 3, before a booking exists). These
 * two used to be different formulas (this one vs. an hourly-rate × duration
 * guess); keeping the math in one place means a worker's Step 3 price can
 * never drift from what they're actually charged for the same job.
 *
 * Condition is deliberately not a factor here — it's an ordinary
 * admin-defined scope field now, not a platform-wide surcharge.
 *
 * Urgency (STANDARD/URGENT/EMERGENCY) used to add a 0/15/30% surcharge here
 * too, but was removed as a platform concept (2026-09-14) — it only ever
 * charged more for a "faster" booking without actually doing anything
 * differently (no matching priority, no different notification), and its
 * shorter auto-cancel window (see bookingQueue's old EXPIRY_MULTIPLIER)
 * actively worked against the client who paid for it. `urgencyFee` is kept
 * (always 0) in the result/log shape below for compatibility with existing
 * receipts, same as conditionFee. Same-day/next-day booking is now blocked
 * outright instead (see validation.ts's MIN_BOOKING_LEAD_DAYS), which was
 * the actual reason anyone reached for "urgent" in the first place.
 */
// Fallback only — the live, admin-tunable values are AppSettings.freeDistanceKm
// / perKmFee (see appSettingsService), passed in by every real caller.
// Kept here so a caller that doesn't have an AppSettings row handy (tests,
// scripts) still gets sane defaults instead of a free/zero distance fee.
const DEFAULT_FREE_DISTANCE_KM = 5;
const DEFAULT_PER_KM_FEE = 10;

export interface JobPricingInput {
  basePrice: number;
  tierMultiplier: number;
  distanceKm?: number | null;
  freeDistanceKm?: number;
  perKmFee?: number;
}

export interface JobPricingResult {
  basePrice: number;
  distanceFee: number;
  urgencyFee: number;
  tierFee: number;
  estimatedPrice: number;
}

export const computeJobPricing = (input: JobPricingInput): JobPricingResult => {
  const freeDistanceKm = input.freeDistanceKm ?? DEFAULT_FREE_DISTANCE_KM;
  const perKmFee = input.perKmFee ?? DEFAULT_PER_KM_FEE;
  const distanceFee = roundToCentavo(
    input.distanceKm != null ? Math.max(0, input.distanceKm - freeDistanceKm) * perKmFee : 0
  );
  const urgencyFee = 0;
  const tierFee = roundToCentavo(input.basePrice * (input.tierMultiplier - 1));
  const estimatedPrice = roundToCentavo(input.basePrice + distanceFee + urgencyFee + tierFee);
  return { basePrice: input.basePrice, distanceFee, urgencyFee, tierFee, estimatedPrice };
};