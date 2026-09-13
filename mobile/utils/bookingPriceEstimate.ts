/**
 * Client-side live pricing preview for the 4-step booking flow.
 *
 * This is a UX-only estimate — it gives the user fast, real-time feedback as
 * they pick a service/worker/urgency, but the AUTHORITATIVE price is always
 * whatever `POST /bookings` returns in its `pricing` block (computed
 * server-side from ServiceType/ServiceTask base price + distance/urgency/
 * tier fees — see backend `utils/pricing.computeJobPricing`, the single
 * source of truth both the booking-creation endpoint and the worker-search
 * price preview use). This preview mirrors that same formula. Deliberately
 * NOT modeled here: any same-day/date-based premium (the backend has none)
 * and the per-worker distance fee (unknown until a specific worker/address
 * pair is confirmed).
 */
import type { RoomType, UrgencyLevel, WorkerTier } from '../types/booking4step.types';
import { URGENCY_MODIFIER, TIER_MULTIPLIER } from '../types/booking4step.types';

export interface PriceEstimate {
  price: number;
}

/**
 * Pre-worker-selection estimate (Steps 1-2): no worker/tier is known yet, so
 * this is the selected service's price plus the urgency surcharge — the same
 * fixed percentage the backend applies, just without the tier or distance
 * fee (neither is known before a worker is picked).
 */
export function estimatePrice(categoryRate: number, urgencyLevel?: UrgencyLevel | null): PriceEstimate {
  const urgencyFee = categoryRate * (URGENCY_MODIFIER[urgencyLevel ?? 'STANDARD'] - 1);
  return { price: round2(categoryRate + urgencyFee) };
}

export interface PricePointEstimate {
  urgencyModifier: number;
  tierModifier: number;
  laborCost: number;
  addOnsTotal: number;
  tip: number;
  subtotal: number;
  total: number;
}

/**
 * Post-worker-selection estimate (Steps 3-4): the worker's tier is now
 * known, so this adds the tier surcharge to the same base-price + urgency
 * formula used in `estimatePrice` (all fixed percentages of the selected
 * service's price, mirroring the backend — no hourly rate involved).
 */
export function estimatePricePoint(params: {
  categoryRate: number;
  addOnsTotal?: number;
  tip?: number;
  urgencyLevel?: UrgencyLevel | null;
  workerTier?: WorkerTier | null;
}): PricePointEstimate {
  const urgencyModifier = URGENCY_MODIFIER[params.urgencyLevel ?? 'STANDARD'];
  const tierModifier = TIER_MULTIPLIER[params.workerTier ?? 'STANDARD'];
  const urgencyFee = params.categoryRate * (urgencyModifier - 1);
  const tierFee = params.categoryRate * (tierModifier - 1);
  const laborCost = round2(params.categoryRate + urgencyFee + tierFee);
  const addOnsTotal = round2(params.addOnsTotal ?? 0);
  const tip = round2(params.tip ?? 0);
  const subtotal = round2(laborCost + addOnsTotal);
  const total = round2(subtotal + tip);

  return { urgencyModifier, tierModifier, laborCost, addOnsTotal, tip, subtotal, total };
}

/**
 * The backend stores `Booking.rooms` as a flat, possibly-repeated array
 * (e.g. two bedrooms -> ['BEDROOM','BEDROOM']) from the old room-picker
 * flow — kept only to render that field on bookings created before this
 * change; new bookings never populate it.
 */
export function summarizeFlatRoomTypes(rooms: RoomType[], labels: Record<RoomType, string>): string {
  const counts = new Map<RoomType, number>();
  for (const room of rooms) {
    counts.set(room, (counts.get(room) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([room, count]) => `${labels[room]} x${count}`)
    .join(', ');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
