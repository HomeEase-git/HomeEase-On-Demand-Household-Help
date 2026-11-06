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

export function formatPrice(amount: number): string {
  return `₱${amount.toFixed(2)}`;
}

export function getTipSuggestions(subtotal: number): number[] {
  const percentage10 = Math.round(subtotal * 0.1);
  const percentage15 = Math.round(subtotal * 0.15);
  const percentage20 = Math.round(subtotal * 0.2);

  return [percentage10, percentage15, percentage20];
}

export function getServiceBaseRate(category: string): number {
  const normalized = category.toLowerCase();
  return SERVICE_BASE_RATES[normalized] || 250;
}

export function isValidTipAmount(tip: number, subtotal: number): boolean {
  return tip >= 0 && tip <= subtotal * 0.5;
}

export const DEFAULT_COMMISSION_RATE = 0.1;

type WorkerPayoutSource = {
  finalPrice?: number | null;
  estimatedPrice?: number | null;
  workerPayoutEstimate?: number | null;
  payment?: { workerPayout?: number | null } | null;
};

export function getWorkerNetAmount(job: WorkerPayoutSource): number {
  const gross = job.finalPrice ?? job.estimatedPrice ?? 0;
  return (
    job.payment?.workerPayout ??
    job.workerPayoutEstimate ??
    gross * (1 - DEFAULT_COMMISSION_RATE)
  );
}

export function pluralUnit(unit: string): string {
  return /^[a-z]+$/i.test(unit) && !/s$/i.test(unit) ? `${unit}s` : unit;
}

export function formatQuantity(quantity: number, unit: string | null | undefined): string {
  const u = unit || "unit";
  return `${quantity} ${quantity === 1 ? u : pluralUnit(u)}`;
}
