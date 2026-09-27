/**
 * Task prices are set by the admin only. ServiceTask.basePrice is the price
 * every client pays and every worker earns for that job (before the worker's
 * expertise-tier surcharge and the distance fee, see utils/pricing.ts):
 *  - FIXED: basePrice is the flat price.
 *  - PER_UNIT: basePrice is the rate per unit, times the quantity answer.
 *  - TIERED: retired (it was worker-defined price steps); any leftover task
 *    is charged like PER_UNIT so it never becomes unbookable.
 *  - CUSTOM_QUOTE: no upfront price; the worker quotes after inspecting.
 *
 * Workers no longer set prices, so the old WorkerTaskPrice /
 * WorkerTaskTierPrice rows and ServiceTask.minPrice/maxPrice are ignored.
 */

export function isPerUnitModel(pricingModel: string): boolean {
  return pricingModel === 'PER_UNIT' || pricingModel === 'TIERED';
}

export type TaskPriceResult = { ok: true; basePrice: number } | { ok: false; missingLabel: string };

/**
 * The job's base price for a booking. Per-unit tasks need the quantity
 * answer (keyed by the quantity question's label, like every scope answer);
 * a missing or non-numeric answer is reported so the caller can 400.
 */
export function taskBasePrice(
  task: { basePrice: number; pricingModel: string; quantityScopeField?: { label: string } | null },
  scopeAnswers: Record<string, unknown> | null | undefined
): TaskPriceResult {
  if (task.pricingModel === 'CUSTOM_QUOTE') return { ok: true, basePrice: 0 };
  if (!isPerUnitModel(task.pricingModel)) return { ok: true, basePrice: task.basePrice };

  const field = task.quantityScopeField;
  const quantity = field ? Number(scopeAnswers?.[field.label]) : NaN;
  if (!field || Number.isNaN(quantity)) {
    return { ok: false, missingLabel: field?.label ?? 'quantity' };
  }
  return { ok: true, basePrice: Math.round(task.basePrice * quantity * 100) / 100 };
}

/** Prisma filter: the worker has ticked this task as one they do. */
export function offersTaskFilter(serviceTaskId: string) {
  return { taskSelections: { some: { serviceTaskId, isActive: true } } };
}
