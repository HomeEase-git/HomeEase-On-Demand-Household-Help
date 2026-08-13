/**
 * Pricing Utility
 * Formatting and estimate helpers for booking prices. The authoritative
 * charge (subtotal/tip/total) always comes from the backend's Payment
 * record — nothing here invents a tax or commission figure to charge the
 * client; commission/withholding tax are deducted from the worker's payout
 * only (see backend/src/utils/pricing.ts).
 */

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
 * Format currency for display
 */
export function formatPrice(amount: number): string {
  return `₱${amount.toFixed(2)}`;
}

const QUOTE_REQUIRED_KEYWORDS = ["inspection", "diagnos", "assessment", "estimate"];

/**
 * Best-effort signal that a task's price is only an estimate until the
 * worker inspects the job and submits a quote (e.g. "General Appliance
 * Diagnosis", "Panel Inspection"). Service tasks are managed server-side
 * with no explicit pricing-type field, so this matches on the task's own
 * name/description rather than a fixed id.
 */
export function isLikelyQuoteRequired(name: string | null | undefined, description?: string | null): boolean {
  const haystack = `${name ?? ""} ${description ?? ""}`.toLowerCase();
  return QUOTE_REQUIRED_KEYWORDS.some((keyword) => haystack.includes(keyword));
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

/**
 * Fallback commission rate used only when neither a settled payout nor a
 * server-computed estimate is available. The live rate is admin-configurable
 * on the backend (AppSettings.commissionRate) — this is a display-only
 * approximation, never used to actually charge or pay anyone.
 */
export const DEFAULT_COMMISSION_RATE = 0.1;

type WorkerPayoutSource = {
  finalPrice?: number | null;
  estimatedPrice?: number | null;
  workerPayoutEstimate?: number | null;
  payment?: { workerPayout?: number | null } | null;
};

/**
 * A worker's take-home amount for a job, so every screen agrees with the
 * Earnings tab instead of each computing its own (in)consistent number.
 * Prefers the settled Payment row's workerPayout, then the backend's live
 * workerPayoutEstimate, then a local fallback using DEFAULT_COMMISSION_RATE.
 */
export function getWorkerNetAmount(job: WorkerPayoutSource): number {
  const gross = job.finalPrice ?? job.estimatedPrice ?? 0;
  return (
    job.payment?.workerPayout ??
    job.workerPayoutEstimate ??
    gross * (1 - DEFAULT_COMMISSION_RATE)
  );
}
