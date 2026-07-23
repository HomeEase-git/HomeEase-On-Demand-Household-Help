"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatPrice = exports.validatePriceBreakdown = exports.getPriceBreakdown = exports.calculatePlatformProfit = exports.calculateWorkerPayout = exports.calculateWithholdingTax = exports.calculateCommission = void 0;
/**
 * Pricing utilities for commission, tax, and payout calculations
 * This mirrors the logic in mobile/utils/pricing.ts to ensure both sides agree
 */
const pricing_1 = require("@config/pricing");
/**
 * Platform commission percentage (takes a cut of each transaction)
 */
const COMMISSION_PERCENTAGE = pricing_1.COMMISSION_RATE * 100; // Convert to percentage
/**
 * Withholding tax percentage for workers (tax compliance)
 */
const WITHHOLDING_TAX_PERCENTAGE = pricing_1.WITHHOLDING_TAX_RATE * 100; // Convert to percentage
/**
 * Calculate the commission amount
 * Commission is calculated on the subtotal (labor + materials)
 */
const calculateCommission = (subtotal) => {
    return Math.round((subtotal * COMMISSION_PERCENTAGE) / 100 * 100) / 100;
};
exports.calculateCommission = calculateCommission;
/**
 * Calculate withholding tax amount
 * Tax is calculated on the subtotal after commission is deducted
 */
const calculateWithholdingTax = (subtotal) => {
    const afterCommission = subtotal - (0, exports.calculateCommission)(subtotal);
    return Math.round((afterCommission * WITHHOLDING_TAX_PERCENTAGE) / 100 * 100) / 100;
};
exports.calculateWithholdingTax = calculateWithholdingTax;
/**
 * Calculate worker payout
 * Worker receives: subtotal - commission - tax + tip
 */
const calculateWorkerPayout = (subtotal, tip = 0) => {
    const commission = (0, exports.calculateCommission)(subtotal);
    const tax = (0, exports.calculateWithholdingTax)(subtotal);
    const payout = subtotal - commission - tax + tip;
    return Math.round(payout * 100) / 100;
};
exports.calculateWorkerPayout = calculateWorkerPayout;
/**
 * Calculate platform profit
 * Platform keeps: commission + (tax goes to government, but we collect it)
 */
const calculatePlatformProfit = (subtotal, _tip = 0) => {
    const commission = (0, exports.calculateCommission)(subtotal);
    // Note: Withholding tax is collected but remitted to government — not platform profit
    return Math.round(commission * 100) / 100;
};
exports.calculatePlatformProfit = calculatePlatformProfit;
/**
 * Get complete price breakdown
 * Used in responses to show transparent pricing to client and worker
 */
const getPriceBreakdown = (subtotal, tip = 0, platformFee = 0) => {
    const commission = (0, exports.calculateCommission)(subtotal);
    const tax = (0, exports.calculateWithholdingTax)(subtotal);
    const workerPayout = (0, exports.calculateWorkerPayout)(subtotal, tip);
    const platformProfit = (0, exports.calculatePlatformProfit)(subtotal, tip);
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
exports.getPriceBreakdown = getPriceBreakdown;
/**
 * Validate price breakdown integrity
 * Ensures: subtotal + tip + platformFee = total AND workerPayout + commission + tax = subtotal
 */
const validatePriceBreakdown = (breakdown) => {
    const totalCheck = breakdown.subtotal + breakdown.tip + breakdown.platformFee;
    const payoutCheck = breakdown.workerPayout + breakdown.commissionAmount + breakdown.withholdingTaxAmount;
    // Allow small floating-point rounding errors
    const epsilon = 0.01;
    return (Math.abs(totalCheck - breakdown.total) < epsilon &&
        Math.abs(payoutCheck - breakdown.subtotal) < epsilon);
};
exports.validatePriceBreakdown = validatePriceBreakdown;
/**
 * Format currency for display (Philippine Peso)
 */
const formatPrice = (amount) => {
    return `₱${(Math.round(amount * 100) / 100).toFixed(2)}`;
};
exports.formatPrice = formatPrice;
//# sourceMappingURL=pricing.js.map