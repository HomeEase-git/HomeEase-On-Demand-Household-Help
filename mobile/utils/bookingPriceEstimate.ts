/**
 * Client-side live pricing preview for the 4-step booking flow.
 *
 * This is a UX-only estimate — it gives the user fast, real-time feedback as
 * they pick a service/worker, but the AUTHORITATIVE price is always whatever
 * `POST /bookings` returns in its `pricing` block (computed server-side from
 * ServiceType/ServiceTask base price + distance/tier fees — see backend
 * `utils/pricing.computeJobPricing`, the single source of truth both the
 * booking-creation endpoint and the worker-search price preview use).
 *
 * Two shapes come out of this: a `range` (low-high spread) whenever the exact
 * price isn't knowable yet — either no worker is known at all (auto-match, or
 * Steps 1-2 before Step 3), or a specific worker is locked in but we only
 * know their category-level spread, not a job-specific number — and a
 * `point` (single number) once a specific worker's real computed price is
 * known (Step 3's `selectWorker`, mirroring the backend's real formula
 * including that worker's actual distance fee).
 */
import type { RoomType } from '../types/booking4step.types';

export interface PriceRange {
  min: number;
  max: number;
}

/**
 * Range estimate: the marketplace-wide spread for a category (nobody/no
 * specific worker known yet) or one worker's own spread for a category
 * (worker locked in, but no job-specific total computed yet).
 */
export function estimateRange(range: PriceRange): PriceRange {
  return { min: round2(Math.max(0, range.min)), max: round2(Math.max(0, range.max)) };
}

export interface PricePointEstimate {
  laborCost: number;
  // Itemized version of laborCost — set only when the caller has a specific
  // worker's real basePrice/distanceFee/tierFee (see step-3's
  // draft.workerPriceBreakdown); null when only the lumped laborCost is known
  // (e.g. a PER_UNIT rate x quantity, which has no such split).
  priceBreakdown: { basePrice: number; distanceFee: number; tierFee: number } | null;
  addOnsTotal: number;
  tip: number;
  subtotal: number;
  total: number;
}

/**
 * Exact estimate once a specific worker's real price is known — `laborCost`
 * is that worker's computed total (base price + their tier fee + their real
 * distance fee), not re-derived here.
 */
export function estimatePricePoint(params: {
  laborCost: number;
  priceBreakdown?: { basePrice: number; distanceFee: number; tierFee: number } | null;
  addOnsTotal?: number;
  tip?: number;
}): PricePointEstimate {
  const laborCost = round2(params.laborCost);
  const addOnsTotal = round2(params.addOnsTotal ?? 0);
  const tip = round2(params.tip ?? 0);
  const subtotal = round2(laborCost + addOnsTotal);
  const total = round2(subtotal + tip);

  return { laborCost, priceBreakdown: params.priceBreakdown ?? null, addOnsTotal, tip, subtotal, total };
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
