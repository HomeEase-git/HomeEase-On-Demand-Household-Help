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

const COMMISSION_PERCENTAGE = COMMISSION_RATE * 100; // Convert to percentage

const WITHHOLDING_TAX_PERCENTAGE = WITHHOLDING_TAX_RATE * 100; // Convert to percentage

export const calculateCommission = (subtotal: number, commissionRate: number = COMMISSION_RATE): number => {
  return roundToCentavo(subtotal * commissionRate);
};

export const calculateWithholdingTax = (
  subtotal: number,
  commissionRate: number = COMMISSION_RATE,
  withholdingTaxRate: number = WITHHOLDING_TAX_RATE
): number => {
  const afterCommission = subtotal - calculateCommission(subtotal, commissionRate);
  return roundToCentavo(afterCommission * withholdingTaxRate);
};

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

export const computeWorkerEarnings = (input: {
  subtotal: number;
  tip?: number;
  commissionRate?: number;
  withholdingTaxRate?: number;
  vatApplicable?: boolean | null;
  vatRate?: number | null;
}) => {
  const tip = input.tip ?? 0;
  const commissionRate = input.commissionRate ?? COMMISSION_RATE;
  const withholdingTaxRate = input.withholdingTaxRate ?? WITHHOLDING_TAX_RATE;
  const commissionAmount = calculateCommission(input.subtotal, commissionRate);
  const withholdingTaxAmount = calculateWithholdingTax(input.subtotal, commissionRate, withholdingTaxRate);
  const vatAmount = input.vatApplicable ? roundToCentavo(input.subtotal * (input.vatRate ?? VAT_RATE)) : 0;
  const workerPayout = roundToCentavo(input.subtotal - commissionAmount - withholdingTaxAmount + tip + vatAmount);
  return {
    subtotal: roundToCentavo(input.subtotal),
    tip: roundToCentavo(tip),
    commissionRate,
    commissionAmount,
    withholdingTaxAmount,
    vatAmount,
    workerPayout,
  };
};

export const calculatePlatformProfit = (subtotal: number, _tip: number = 0): number => {
  const commission = calculateCommission(subtotal);
  return roundToCentavo(commission);
};

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

export const VAT_RATE = 0.12;

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

export const formatPrice = (amount: number): string => {
  return `₱${roundToCentavo(amount).toFixed(2)}`;
};

const DEFAULT_FREE_DISTANCE_KM = 5;
const DEFAULT_PER_KM_FEE = 10;

export interface JobPricingInput {
  basePrice: number;
  tierMultiplier: number;
  // 0 (or omitted) unless this is a same-day booking.
  rushFeeRate?: number;
  distanceKm?: number | null;
  freeDistanceKm?: number;
  perKmFee?: number;
}

export interface JobPricingResult {
  basePrice: number;
  distanceFee: number;
  urgencyFee: number;
  rushFee: number;
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
  const rushFee = roundToCentavo(input.basePrice * Math.max(0, input.rushFeeRate ?? 0));
  const tierFee = roundToCentavo(input.basePrice * (input.tierMultiplier - 1));
  const estimatedPrice = roundToCentavo(input.basePrice + distanceFee + urgencyFee + rushFee + tierFee);
  return { basePrice: input.basePrice, distanceFee, urgencyFee, rushFee, tierFee, estimatedPrice };
};
export function describeDistanceFee(
  log: { distanceFee?: number | null; breakdown?: unknown } | null,
  live: { freeDistanceKm: number; perKmFee: number }
): string | null {
  if (!log?.distanceFee) return null;
  const b = (log.breakdown ?? {}) as { distanceKm?: number | null; freeDistanceKm?: number; perKmFee?: number };
  const km = b.distanceKm != null ? `${b.distanceKm.toFixed(1)} km from the worker; ` : '';
  return `${km}first ${b.freeDistanceKm ?? live.freeDistanceKm} km free, then ₱${b.perKmFee ?? live.perKmFee}/km`;
}

export function itemizeBookingPrice(
  firstLog: { basePrice: number; distanceFee?: number | null; tierFee?: number | null; rushFee?: number | null } | null,
  booking: { estimatedPrice: number; laborCost?: number | null; materialsCost?: number | null }
) {
  const hasQuote = booking.laborCost != null && booking.materialsCost != null;
  const isCustomQuote = hasQuote && booking.estimatedPrice === 0;
  return {
    basePrice: isCustomQuote ? (booking.laborCost ?? 0) : (firstLog?.basePrice ?? null),
    distanceFee: isCustomQuote ? 0 : (firstLog?.distanceFee ?? 0),
    tierFee: isCustomQuote ? 0 : (firstLog?.tierFee ?? 0),
    rushFee: isCustomQuote ? 0 : (firstLog?.rushFee ?? 0),
    materialsCost: hasQuote ? (booking.materialsCost ?? 0) : 0,
  };
}
