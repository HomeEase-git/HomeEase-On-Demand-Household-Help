/**
 * Task prices are set by the admin only. ServiceTask.basePrice is the price
 * every client pays and every worker earns for that job (before the worker's
 * expertise-tier surcharge and the distance fee, see utils/pricing.ts):
 *  - FIXED: basePrice is the flat price.
 *  - PER_UNIT: basePrice is the rate per unit, times the client's quantity
 *    (Booking.quantity), within the job's minQuantity/maxQuantity.
 *  - TIERED: retired (it was worker-defined price steps); any leftover task
 *    is charged like PER_UNIT so it never becomes unbookable.
 *  - CUSTOM_QUOTE: retired. Former custom-quote jobs were switched off and
 *    are refused at booking (see createBooking).
 *
 * Workers no longer set prices, so ServiceTask.minPrice/maxPrice are ignored.
 */

export function isPerUnitModel(pricingModel: string): boolean {
  return pricingModel === 'PER_UNIT' || pricingModel === 'TIERED';
}

export type TaskPriceResult = { ok: true; basePrice: number; quantity?: number } | { ok: false; message: string };

/** The fewest units a per-unit job can be booked for. */
export const MIN_BOOKABLE_QUANTITY = 1;

/**
 * The job's base price for a booking. Per-unit tasks need the client's
 * quantity. A missing, non-numeric, infinite or below-minimum count is
 * refused, so a per-unit job can never price at ₱0 or below; the job's own
 * minQuantity/maxQuantity (set by the admin) narrow it further.
 */
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

/** Prisma filter: the worker has ticked this task as one they do. */
export function offersTaskFilter(serviceTaskId: string) {
  return { taskSelections: { some: { serviceTaskId, isActive: true } } };
}
