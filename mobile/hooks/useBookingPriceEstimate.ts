import { useMemo } from 'react';
import { useBookingStore } from '../store/bookingStore';
import {
  estimateRange,
  estimatePricePoint,
  type PriceRange,
  type PricePointEstimate,
} from '../utils/bookingPriceEstimate';

export type BookingPriceEstimate =
  | { mode: 'range'; range: PriceRange; unitLabel?: string | null }
  | { mode: 'point'; point: PricePointEstimate; unitLabel?: string | null };

/**
 * Live pricing preview for the booking draft.
 *
 * - `point` mode: once Step 3's `selectWorker` has run, `draft.
 *   workerEstimatedTotal` holds that worker's exact computed price (the
 *   backend's real formula, including their real distance fee) — used
 *   directly as the labor cost so this can never show a different number
 *   than Step 3 did or than `POST /bookings` will actually charge.
 * - PER_UNIT task selected (`draft.selectedTaskPricingModel`): no flat
 *   total exists — `draft.workerUnitPrice` (once a worker's picked) or the
 *   admin's rate bounds (`categoryRange`, before that) is a RATE, not a
 *   total, so it's never fed through `estimatePricePoint`/`estimateRange`
 *   as-is. Multiplied by the quantity scope-answer once both are known
 *   (real point total); shown as a bare rate, `unitLabel` set, otherwise.
 * - `range` mode otherwise: `categoryRange` should already be whichever
 *   spread is right for the current draft — a locked worker's own price
 *   range for the selected category (the worker-profile "Book Now" entry
 *   point resolves this before Step 3 ever runs), or the marketplace-wide
 *   category range for anyone else (plain browsing, or auto-match). Callers
 *   resolve which one that is (see step-1.tsx's `displayCategories`) rather
 *   than this hook, since the same resolved number needs to reach both the
 *   category tiles and this preview.
 *
 * `tipOverride` lets a screen with its own live (not-yet-persisted-to-store)
 * tip state — e.g. step-4's TipSlider, which only writes back to the store
 * on confirm — feed that value in directly so the preview updates as the
 * user drags the slider, instead of showing the stale `draft.tip`.
 */
export function useBookingPriceEstimate(
  categoryRange: PriceRange,
  addOnsTotal = 0,
  tipOverride?: number
): BookingPriceEstimate {
  const draft = useBookingStore((s) => s.draft);
  const tip = tipOverride ?? draft.tip ?? 0;
  const isPerUnit = draft.selectedTaskPricingModel === 'PER_UNIT';
  const quantityAnswer = isPerUnit && draft.selectedTaskQuantityFieldLabel
    ? draft.scopeAnswers?.[draft.selectedTaskQuantityFieldLabel]
    : undefined;
  const quantity = typeof quantityAnswer === 'string' ? Number(quantityAnswer) : NaN;
  const hasQuantity = Number.isFinite(quantity) && quantity > 0;

  return useMemo(() => {
    if (draft.workerEstimatedTotal != null) {
      return {
        mode: 'point',
        point: estimatePricePoint({ laborCost: draft.workerEstimatedTotal, addOnsTotal, tip }),
      };
    }

    if (isPerUnit) {
      const rate = draft.workerUnitPrice ?? null;
      if (rate != null && hasQuantity) {
        return {
          mode: 'point',
          point: estimatePricePoint({ laborCost: rate * quantity, addOnsTotal, tip }),
        };
      }
      // No total is knowable yet (either no worker picked, or no quantity
      // entered) — show the rate itself, labeled, rather than a misleading
      // total. Uses the worker's own rate once picked, else the admin bounds.
      const rateRange = rate != null ? { min: rate, max: rate } : categoryRange;
      return { mode: 'range', range: estimateRange(rateRange), unitLabel: draft.selectedTaskUnitLabel };
    }

    return { mode: 'range', range: estimateRange(categoryRange) };
  }, [
    draft.workerEstimatedTotal,
    draft.workerUnitPrice,
    draft.selectedTaskUnitLabel,
    isPerUnit,
    hasQuantity,
    quantity,
    tip,
    categoryRange.min,
    categoryRange.max,
    addOnsTotal,
  ]);
}
