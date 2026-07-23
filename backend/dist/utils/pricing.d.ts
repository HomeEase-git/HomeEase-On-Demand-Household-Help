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
 * Calculate the commission amount
 * Commission is calculated on the subtotal (labor + materials)
 */
export declare const calculateCommission: (subtotal: number) => number;
/**
 * Calculate withholding tax amount
 * Tax is calculated on the subtotal after commission is deducted
 */
export declare const calculateWithholdingTax: (subtotal: number) => number;
/**
 * Calculate worker payout
 * Worker receives: subtotal - commission - tax + tip
 */
export declare const calculateWorkerPayout: (subtotal: number, tip?: number) => number;
/**
 * Calculate platform profit
 * Platform keeps: commission + (tax goes to government, but we collect it)
 */
export declare const calculatePlatformProfit: (subtotal: number, _tip?: number) => number;
/**
 * Get complete price breakdown
 * Used in responses to show transparent pricing to client and worker
 */
export declare const getPriceBreakdown: (subtotal: number, tip?: number, platformFee?: number) => PriceBreakdown;
/**
 * Validate price breakdown integrity
 * Ensures: subtotal + tip + platformFee = total AND workerPayout + commission + tax = subtotal
 */
export declare const validatePriceBreakdown: (breakdown: PriceBreakdown) => boolean;
/**
 * Format currency for display (Philippine Peso)
 */
export declare const formatPrice: (amount: number) => string;
//# sourceMappingURL=pricing.d.ts.map