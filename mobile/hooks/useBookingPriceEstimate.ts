import { useMemo } from 'react';
import { useBookingStore } from '../store/bookingStore';
import { RUSH_FEE_RATE, isRushDate } from '../utils/bookingTime';
import {
  estimateRange,
  estimatePricePoint,
  type PriceRange,
  type PricePointEstimate,
} from '../utils/bookingPriceEstimate';

export type BookingPriceEstimate =
  | { mode: 'range'; range: PriceRange; unitLabel?: string | null }
  | { mode: 'point'; point: PricePointEstimate; unitLabel?: string | null };

export function useBookingPriceEstimate(
  categoryRange: PriceRange,
  addOnsTotal = 0,
  tipOverride?: number,
  perUnitOverride?: { quantity?: number; unitLabel?: string | null }
): BookingPriceEstimate {
  const draft = useBookingStore((s) => s.draft);
  const tip = tipOverride ?? draft.tip ?? 0;
  const isPerUnit = !!perUnitOverride || draft.selectedTaskPricingModel === 'PER_UNIT';
  const quantityOverride = perUnitOverride ? (perUnitOverride.quantity ?? NaN) : undefined;
  const unitLabel = perUnitOverride ? perUnitOverride.unitLabel : draft.selectedTaskUnitLabel;
  const quantity = isPerUnit ? Number(quantityOverride ?? draft.quantity ?? NaN) : NaN;
  const hasQuantity = Number.isFinite(quantity) && quantity >= 1;
  const rushFactor = isRushDate(draft.date) ? 1 + RUSH_FEE_RATE : 1;
  const effectiveRange = { min: categoryRange.min * rushFactor, max: categoryRange.max * rushFactor };

  return useMemo(() => {
    if (draft.workerEstimatedTotal != null) {
      return {
        mode: 'point',
        point: estimatePricePoint({
          laborCost: draft.workerEstimatedTotal,
          priceBreakdown: draft.workerPriceBreakdown,
          addOnsTotal,
          tip,
        }),
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
      const rateRange = rate != null ? { min: rate, max: rate } : effectiveRange;
      if (hasQuantity) {
        return { mode: 'range', range: estimateRange({ min: rateRange.min * quantity, max: rateRange.max * quantity }) };
      }
      return { mode: 'range', range: estimateRange(rateRange), unitLabel };
    }

    return { mode: 'range', range: estimateRange(effectiveRange) };
  }, [
    draft.workerEstimatedTotal,
    draft.workerPriceBreakdown,
    draft.workerUnitPrice,
    unitLabel,
    isPerUnit,
    hasQuantity,
    quantity,
    tip,
    effectiveRange.min,
    effectiveRange.max,
    addOnsTotal,
  ]);
}

export function useDraftPriceEstimate(): BookingPriceEstimate | null {
  const draft = useBookingStore((s) => s.draft);
  const estimate = useBookingPriceEstimate({
    min: draft.selectedTaskPriceRangeMin ?? draft.categoryPriceRangeMin ?? draft.categoryBasePrice ?? 0,
    max: draft.selectedTaskPriceRangeMax ?? draft.categoryPriceRangeMax ?? draft.categoryBasePrice ?? 0,
  });
  return estimate;
}
