export function isPerUnitModel(pricingModel: string): boolean {
  return pricingModel === 'PER_UNIT' || pricingModel === 'TIERED';
}

export type TaskPriceResult = { ok: true; basePrice: number; quantity?: number } | { ok: false; message: string };

/** The fewest units a per-unit job can be booked for. */
export const MIN_BOOKABLE_QUANTITY = 1;

export function taskBasePrice(
  task: {
    basePrice: number;
    pricingModel: string;
    unitLabel?: string | null;
    minQuantity?: number | null;
    maxQuantity?: number | null;
  },
  quantity: unknown
): TaskPriceResult {
  if (!isPerUnitModel(task.pricingModel)) return { ok: true, basePrice: task.basePrice };

  const unit = task.unitLabel?.trim() || 'unit';
  if (quantity === undefined || quantity === null || (typeof quantity === 'string' && !quantity.trim())) {
    return { ok: false, message: `Enter how many (${unit}) for this job` };
  }
  const count = Number(quantity);
  const min = Math.max(MIN_BOOKABLE_QUANTITY, task.minQuantity ?? MIN_BOOKABLE_QUANTITY);
  if (!Number.isFinite(count) || count < min) {
    return { ok: false, message: `This job needs at least ${min} (${unit})` };
  }
  if (task.maxQuantity != null && count > task.maxQuantity) {
    return { ok: false, message: `This job takes at most ${task.maxQuantity} (${unit})` };
  }
  return { ok: true, basePrice: Math.round(task.basePrice * count * 100) / 100, quantity: count };
}

export function offersTaskFilter(serviceTaskId: string) {
  return { taskSelections: { some: { serviceTaskId, isActive: true } } };
}
