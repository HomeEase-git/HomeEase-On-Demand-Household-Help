/**
 * Pricing utilities for commission, tax, and payout calculations
 * This mirrors the logic in mobile/utils/pricing.ts to ensure both sides agree
 */
import { COMMISSION_RATE, WITHHOLDING_TAX_RATE } from '@config/pricing';

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
  return Math.round(subtotal * commissionRate * 100) / 100;
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
  return Math.round(afterCommission * withholdingTaxRate * 100) / 100;
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
  return Math.round(payout * 100) / 100;
};

/**
 * Calculate platform profit
 * Platform keeps: commission + (tax goes to government, but we collect it)
 */
export const calculatePlatformProfit = (subtotal: number, _tip: number = 0): number => {
  const commission = calculateCommission(subtotal);
  // Note: Withholding tax is collected but remitted to government — not platform profit
  return Math.round(commission * 100) / 100;
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
    subtotal: Math.round(subtotal * 100) / 100,
    commissionAmount: commission,
    commissionPercentage: COMMISSION_PERCENTAGE,
    withholdingTaxAmount: tax,
    withholdingTaxPercentage: WITHHOLDING_TAX_PERCENTAGE,
    platformFee: Math.round(platformFee * 100) / 100,
    tip: Math.round(tip * 100) / 100,
    total: Math.round(total * 100) / 100,
    workerPayout: workerPayout,
    platformProfit: platformProfit,
  };
};

/**
 * Single source of truth for a booking's final billable total, used at the
 * pay-after-completion step (bookingController.completeBooking locks it in,
 * confirmCompletion / the invoice webhook / auto-settle all read it).
 *
 * subtotal = (approved quote: labor + materials) OR (no quote: the estimate)
 *            + priced add-ons
 * totalAmount = subtotal + tip
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
}

export const computeBookingFinalTotal = (
  booking: BookingFinalTotalInput
): { subtotal: number; tip: number; totalAmount: number } => {
  const addOnsTotal = (booking.addOns ?? []).reduce(
    (sum, a) => sum + (typeof a.price === 'number' ? a.price : 0),
    0
  );
  const hasQuote = booking.laborCost != null && booking.materialsCost != null;
  const base = hasQuote
    ? (booking.laborCost ?? 0) + (booking.materialsCost ?? 0)
    : booking.estimatedPrice;
  const subtotal = Math.round((base + addOnsTotal) * 100) / 100;
  const tip = Math.round(((booking.tip ?? 0)) * 100) / 100;
  const totalAmount = Math.round((subtotal + tip) * 100) / 100;
  return { subtotal, tip, totalAmount };
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
  return `₱${(Math.round(amount * 100) / 100).toFixed(2)}`;
};