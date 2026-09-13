import { useMemo } from 'react';
import { useBookingStore } from '../store/bookingStore';
import {
  estimatePrice,
  estimatePricePoint,
  type PriceEstimate,
  type PricePointEstimate,
} from '../utils/bookingPriceEstimate';

export type BookingPriceEstimate =
  | { mode: 'range'; range: PriceEstimate }
  | { mode: 'point'; point: PricePointEstimate };

/**
 * Live pricing preview for the booking draft. Returns a range while no
 * worker is selected yet (Steps 1-2, since a specific tier isn't known), and
 * a single point estimate once one is picked or auto-match is confirmed
 * (Steps 3-4). This is a client-side UX preview only — see
 * utils/bookingPriceEstimate.ts for why it doesn't need to match the
 * backend's authoritative pricing exactly.
 *
 * `tipOverride` lets a screen with its own live (not-yet-persisted-to-store)
 * tip state — e.g. step-4's TipSlider, which only writes back to the store
 * on confirm — feed that value in directly so the preview updates as the
 * user drags the slider, instead of showing the stale `draft.tip`.
 */
export function useBookingPriceEstimate(
  categoryRate: number,
  addOnsTotal = 0,
  tipOverride?: number
): BookingPriceEstimate {
  const draft = useBookingStore((s) => s.draft);
  const tip = tipOverride ?? draft.tip ?? 0;

  return useMemo(() => {
    if (draft.workerId != null || draft.isAutoMatched) {
      return {
        mode: 'point',
        point: estimatePricePoint({
          categoryRate,
          addOnsTotal,
          tip,
          urgencyLevel: draft.urgencyLevel,
          workerTier: draft.workerTier,
        }),
      };
    }

    return {
      mode: 'range',
      range: estimatePrice(categoryRate, draft.urgencyLevel),
    };
  }, [draft.workerId, draft.isAutoMatched, draft.workerTier, draft.urgencyLevel, tip, categoryRate, addOnsTotal]);
}
