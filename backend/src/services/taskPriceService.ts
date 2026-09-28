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

export type TaskPriceResult = { ok: true; basePrice: number } | { ok: false; missingLabel: string; message: string };

/** The fewest units a per-unit job can be booked for. */
export const MIN_BOOKABLE_QUANTITY = 1;

/**
 * The job's base price for a booking. Per-unit tasks need the quantity
 * answer (keyed by the quantity question's label, like every scope answer).
 * A missing, non-numeric, infinite or below-1 count is refused, so a per-unit
 * job can never price at ₱0 or below, whatever limits the question was
 * configured with.
 */
export function taskBasePrice(
  task: { basePrice: number; pricingModel: string; quantityScopeField?: { label: string } | null },
  scopeAnswers: Record<string, unknown> | null | undefined
): TaskPriceResult {
  if (task.pricingModel === 'CUSTOM_QUOTE') return { ok: true, basePrice: 0 };
  if (!isPerUnitModel(task.pricingModel)) return { ok: true, basePrice: task.basePrice };

  const field = task.quantityScopeField;
  const label = field?.label ?? 'quantity';
  const raw = field ? scopeAnswers?.[field.label] : undefined;
  if (!field || raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) {
    return { ok: false, missingLabel: label, message: `"${label}" is required for this service` };
  }
  const quantity = Number(raw);
  if (!Number.isFinite(quantity) || quantity < MIN_BOOKABLE_QUANTITY) {
    return { ok: false, missingLabel: label, message: `"${label}" must be at least ${MIN_BOOKABLE_QUANTITY}` };
  }
  return { ok: true, basePrice: Math.round(task.basePrice * quantity * 100) / 100 };
}

/** Prisma filter: the worker has ticked this task as one they do. */
export function offersTaskFilter(serviceTaskId: string) {
  return { taskSelections: { some: { serviceTaskId, isActive: true } } };
}
