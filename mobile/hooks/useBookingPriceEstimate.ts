import { useMemo } from 'react';
import { useBookingStore } from '../store/bookingStore';
import {
  estimateRange,
  estimatePricePoint,
  type PriceRange,
  type PricePointEstimate,
} from '../utils/bookingPriceEstimate';

export type BookingPriceEstimate =
  | { mode: 'range'; range: PriceRange }
  | { mode: 'point'; point: PricePointEstimate };

/**
 * Live pricing preview for the booking draft.
 *
 * - `point` mode: once Step 3's `selectWorker` has run, `draft.
 *   workerEstimatedTotal` holds that worker's exact computed price (the
 *   backend's real formula, including their real distance fee) — used
 *   directly as the labor cost so this can never show a different number
 *   than Step 3 did or than `POST /bookings` will actually charge.
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

  return useMemo(() => {
    if (draft.workerEstimatedTotal != null) {
      return {
        mode: 'point',
        point: estimatePricePoint({ laborCost: draft.workerEstimatedTotal, addOnsTotal, tip }),
      };
    }

    return { mode: 'range', range: estimateRange(categoryRange) };
  }, [draft.workerEstimatedTotal, tip, categoryRange.min, categoryRange.max, addOnsTotal]);
}
