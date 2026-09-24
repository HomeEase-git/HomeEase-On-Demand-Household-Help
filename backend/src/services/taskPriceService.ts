import type { Prisma } from '@prisma/client';
/**
 * Pure boundary check for a worker-set WorkerTaskPrice against the admin
 * bounds on its ServiceTask — split out like pricingRuleService's
 * isPriceWithinBounds so it's directly unit-testable without touching the DB.
 */
export function isPriceWithinTaskBounds(
  price: number,
  task: { minPrice: number | null; maxPrice: number | null }
): boolean {
  if (task.minPrice == null || task.maxPrice == null) return true;
  return price >= task.minPrice && price <= task.maxPrice;
}

/**
 * Resolves a TIERED task's price for a given quantity from one worker's own
 * WorkerTaskTierPrice rows — walks the rows in ascending upToQty order (null
 * treated as +Infinity, i.e. sorts last) and returns the first row's price
 * where `upToQty == null || quantity <= upToQty`. Returns null when no row
 * covers the quantity (the worker simply hasn't priced that range) — this is
 * an expected, worker-controlled outcome, not an error to recover from; every
 * caller (search, auto-match, booking) treats it exactly like "hasn't priced
 * this task at all."
 */
export function resolveTierPrice(
  tiers: Array<{ upToQty: number | null; price: number }>,
  quantity: number
): number | null {
  const sorted = [...tiers].sort((a, b) => (a.upToQty ?? Infinity) - (b.upToQty ?? Infinity));
  const match = sorted.find((t) => t.upToQty == null || quantity <= t.upToQty);
  return match ? match.price : null;
}

export const MAX_TIER_ROWS = 5;

/**
 * Validates a worker's proposed TIERED price table before it's saved —
 * 1-MAX_TIER_ROWS rows, strictly ascending upToQty, null (open-ended) allowed
 * only on the last row, every price within the task's own admin-set bound
 * (the same bound PER_UNIT's rate is checked against — TIERED has no
 * separate per-row bound, see ServiceTask.minPrice/maxPrice).
 */
export function validateTierRows(
  rows: Array<{ upToQty: number | null; price: number }>,
  bounds: { minPrice: number | null; maxPrice: number | null }
): string | null {
  if (rows.length === 0) return 'At least one price tier is required.';
  if (rows.length > MAX_TIER_ROWS) return `At most ${MAX_TIER_ROWS} price tiers are allowed.`;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (typeof row.price !== 'number' || Number.isNaN(row.price)) {
      return 'Every tier needs a valid price.';
    }
    if (!isPriceWithinTaskBounds(row.price, bounds)) {
      return `Every tier's price must be between ₱${bounds.minPrice} and ₱${bounds.maxPrice}.`;
    }
    if (row.upToQty == null) {
      if (i !== rows.length - 1) {
        return 'Only the last tier may be open-ended (no upper limit).';
      }
      continue;
    }
    if (typeof row.upToQty !== 'number' || Number.isNaN(row.upToQty) || row.upToQty <= 0) {
      return 'Every tier\'s quantity limit must be a positive number.';
    }
    if (i > 0) {
      const prev = rows[i - 1].upToQty;
      if (prev == null || row.upToQty <= prev) {
        return 'Tier quantity limits must strictly increase.';
      }
    }
  }
  return null;
}

/**
 * The stored WorkerTaskPrice value a FIXED or PER_UNIT task is charged from
 * (price for FIXED, unitPrice for PER_UNIT), or null when the worker hasn't
 * set that one. A task whose pricing model changed after the worker priced
 * it can have only the other value — treated as not priced, never as ₱0.
 */
export function storedWorkerPrice(
  pricingModel: string,
  workerPrice: { price: number | null; unitPrice: number | null; isActive: boolean } | null
): number | null {
  if (!workerPrice?.isActive) return null;
  return (pricingModel === 'FIXED' ? workerPrice.price : workerPrice.unitPrice) ?? null;
}

/** Prisma filter: the worker has an active, usable price for this FIXED/PER_UNIT task. */
export function pricedTaskFilter(serviceTaskId: string, pricingModel: string) {
  return {
    taskPrices: {
      some: {
        serviceTaskId,
        isActive: true,
        ...(pricingModel === 'FIXED' ? { price: { not: null } } : { unitPrice: { not: null } }),
      },
    },
  };
}

/**
 * When an admin switches a task between FIXED and PER_UNIT, carry each
 * worker's price across (flat price <-> per-unit rate) so they stay bookable
 * at the price they chose. Otherwise their stored value is the one the new
 * model doesn't read, and they'd silently drop out of search. Only fills an
 * empty slot; a value the worker set themselves is never overwritten.
 */
export async function carryWorkerPricesAcrossModelChange(
  tx: Prisma.TransactionClient,
  serviceTaskId: string,
  fromModel: string,
  toModel: string
): Promise<number> {
  if (fromModel === 'FIXED' && toModel === 'PER_UNIT') {
    return tx.$executeRaw`UPDATE "WorkerTaskPrice" SET "unitPrice" = "price", "updatedAt" = NOW()
      WHERE "serviceTaskId" = ${serviceTaskId} AND "unitPrice" IS NULL AND "price" IS NOT NULL`;
  }
  if (fromModel === 'PER_UNIT' && toModel === 'FIXED') {
    return tx.$executeRaw`UPDATE "WorkerTaskPrice" SET "price" = "unitPrice", "updatedAt" = NOW()
      WHERE "serviceTaskId" = ${serviceTaskId} AND "price" IS NULL AND "unitPrice" IS NOT NULL`;
  }
  return 0;
}
