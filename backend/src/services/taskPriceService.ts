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
