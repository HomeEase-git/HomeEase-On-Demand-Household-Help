import { useMemo } from 'react';
import { useBookingStore } from '../store/bookingStore';
import {
  estimatePriceRange,
  estimatePricePoint,
  type PriceRangeEstimate,
  type PricePointEstimate,
} from '../utils/bookingPriceEstimate';
import type { ConditionType, RoomSelection, ServiceScopeType } from '../types/booking4step.types';

export type BookingPriceEstimate =
  | { mode: 'range'; range: PriceRangeEstimate }
  | { mode: 'point'; point: PricePointEstimate };

/**
 * `liveOverrides` lets a screen with its own live (not-yet-committed-to-store)
 * rooms/condition/scopeType state — e.g. step-1, which only writes rooms and
 * condition back into the store on "Next" — feed those values in directly so
 * the preview updates as the user picks a room or condition, instead of
 * showing the stale `draft.rooms`/`draft.condition`.
 */
export type BookingPriceEstimateLiveOverrides = {
  rooms?: RoomSelection[];
  condition?: ConditionType | null;
  scopeType?: ServiceScopeType | null;
};

/**
 * Live pricing preview for the booking draft. Returns a range while no
 * worker is selected yet (Steps 1-2, since a specific hourly rate isn't
 * known), and a single point estimate once one is (Steps 3-4). This is a
 * client-side UX preview only — see utils/bookingPriceEstimate.ts for why it
 * doesn't need to match the backend's authoritative pricing exactly.
 *
 * `tipOverride` lets a screen with its own live (not-yet-persisted-to-store)
 * tip state — e.g. step-4's TipSlider, which only writes back to the store
 * on confirm — feed that value in directly so the preview updates as the
 * user drags the slider, instead of showing the stale `draft.tip`.
 */
export function useBookingPriceEstimate(
  categoryRate: number,
  addOnsTotal = 0,
  tipOverride?: number,
  liveOverrides?: BookingPriceEstimateLiveOverrides
): BookingPriceEstimate {
  const draft = useBookingStore((s) => s.draft);
  const tip = tipOverride ?? draft.tip ?? 0;
  const rooms = liveOverrides?.rooms ?? draft.rooms ?? [];
  const condition = liveOverrides?.condition !== undefined ? liveOverrides.condition : draft.condition ?? null;
  const scopeType = liveOverrides?.scopeType !== undefined ? liveOverrides.scopeType : draft.scopeType;

  return useMemo(() => {
    if (draft.workerHourlyRate != null) {
      return {
        mode: 'point',
        point: estimatePricePoint({
          rooms,
          condition,
          workerHourlyRate: draft.workerHourlyRate,
          dateIso: draft.date,
          addOnsTotal,
          tip,
          scopeType,
        }),
      };
    }

    return {
      mode: 'range',
      range: estimatePriceRange(rooms, condition, categoryRate, scopeType),
    };
  }, [rooms, condition, draft.workerHourlyRate, draft.date, scopeType, tip, categoryRate, addOnsTotal]);
}
