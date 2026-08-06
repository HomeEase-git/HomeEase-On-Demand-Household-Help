/**
 * Client-side live pricing preview for the 4-step booking flow.
 *
 * This is a UX-only estimate — it gives the user fast, real-time feedback as
 * they adjust rooms/condition/date/worker, but the AUTHORITATIVE price is
 * always whatever `POST /bookings` returns in its `pricing` block (computed
 * server-side from ServiceTask/ServiceType base price + condition surcharge
 * + distance fee, see backend `bookingController.createBooking`). The two
 * formulas are intentionally different: the backend doesn't know a specific
 * worker's rate until one is matched/selected, so it prices off the service
 * catalog; this preview prices off room count/condition/worker rate per the
 * product's "live pricing calculator" spec so the client sees something
 * responsive to their choices before a worker or final price exists.
 */
import type { ConditionType, RoomSelection, RoomType, ServiceScopeType } from '../types/booking4step.types';
import { CONDITION_MULTIPLIER } from '../types/booking4step.types';

// Flat duration baseline used for CUSTOM-scope services (Appliance Repair,
// Pest Control, ...), where there's no room count to derive duration from.
const CUSTOM_SCOPE_FLAT_HOURS = 1;

export const MINUTES_PER_ROOM = 45;
export const PEAK_MODIFIER_TODAY = 1.3;
export const PEAK_MODIFIER_ADVANCE = 0.9;

/** Platform-enforced worker hourly rate bounds (see backend PATCH /workers/me/rate). */
export const PLATFORM_MIN_RATE = 20;
export const PLATFORM_MAX_RATE = 100;

export function totalRoomCount(rooms: RoomSelection[]): number {
  return rooms.reduce((sum, r) => sum + r.count, 0);
}

/**
 * Base duration = room count * 45 mins * condition multiplier
 * (Tidy: 0.8, Normal: 1.0, Heavy: 1.6). `flatHoursOverride` bypasses the
 * room-count math entirely — used for CUSTOM-scope services, which have no
 * room count to derive duration from.
 */
export function estimateDurationHours(
  rooms: RoomSelection[],
  condition: ConditionType | null,
  flatHoursOverride?: number
): number {
  if (flatHoursOverride != null) return flatHoursOverride;
  const roomCount = totalRoomCount(rooms);
  if (roomCount === 0) return 0;
  const multiplier = condition ? CONDITION_MULTIPLIER[condition] : 1;
  return (roomCount * MINUTES_PER_ROOM * multiplier) / 60;
}

/** Peak modifier: booking for today costs more than booking in advance. */
export function peakModifierForDate(dateIso: string | null): number {
  if (!dateIso) return PEAK_MODIFIER_ADVANCE;
  const today = new Date();
  const target = new Date(dateIso);
  const isToday =
    today.getFullYear() === target.getFullYear() &&
    today.getMonth() === target.getMonth() &&
    today.getDate() === target.getDate();
  return isToday ? PEAK_MODIFIER_TODAY : PEAK_MODIFIER_ADVANCE;
}

export interface PriceRangeEstimate {
  low: number;
  high: number;
  durationHours: number;
}

/**
 * Pre-worker-selection estimate (Steps 1-2): since the actual worker's rate
 * isn't known yet, shows a range spanning the peak-vs-advance modifier
 * against a category rate proxy (ServiceType.basePrice — the closest
 * available stand-in for "typical hourly rate" before a worker is picked).
 */
export function estimatePriceRange(
  rooms: RoomSelection[],
  condition: ConditionType | null,
  categoryRate: number,
  scopeType?: ServiceScopeType | null
): PriceRangeEstimate {
  const durationHours = estimateDurationHours(rooms, condition, scopeType === 'CUSTOM' ? CUSTOM_SCOPE_FLAT_HOURS : undefined);
  const low = round2(durationHours * categoryRate * PEAK_MODIFIER_ADVANCE);
  const high = round2(durationHours * categoryRate * PEAK_MODIFIER_TODAY);
  return { low, high, durationHours };
}

export interface PricePointEstimate {
  durationHours: number;
  peakModifier: number;
  laborCost: number;
  addOnsTotal: number;
  tip: number;
  subtotal: number;
  total: number;
}

/**
 * Post-worker-selection estimate (Steps 3-4): a specific worker's hourly
 * rate and the chosen date are both known, so this collapses to a point
 * estimate: duration * rate * peakModifier + add-ons + tip.
 */
export function estimatePricePoint(params: {
  rooms: RoomSelection[];
  condition: ConditionType | null;
  workerHourlyRate: number;
  dateIso: string | null;
  addOnsTotal?: number;
  tip?: number;
  scopeType?: ServiceScopeType | null;
}): PricePointEstimate {
  const durationHours = estimateDurationHours(
    params.rooms,
    params.condition,
    params.scopeType === 'CUSTOM' ? CUSTOM_SCOPE_FLAT_HOURS : undefined
  );
  const peakModifier = peakModifierForDate(params.dateIso);
  const laborCost = round2(durationHours * params.workerHourlyRate * peakModifier);
  const addOnsTotal = round2(params.addOnsTotal ?? 0);
  const tip = round2(params.tip ?? 0);
  const subtotal = round2(laborCost + addOnsTotal);
  const total = round2(subtotal + tip);

  return { durationHours, peakModifier, laborCost, addOnsTotal, tip, subtotal, total };
}

export function formatRoomSummary(rooms: RoomSelection[], labels: Record<RoomType, string>): string {
  return rooms
    .filter((r) => r.count > 0)
    .map((r) => `${labels[r.room]} x${r.count}`)
    .join(', ');
}

/**
 * The backend stores `Booking.rooms` as a flat, possibly-repeated array
 * (e.g. two bedrooms -> ['BEDROOM','BEDROOM']) rather than the
 * {room,count}[] shape used while building the draft — this tallies a flat
 * array back into the same "Bedroom x2, Kitchen x1" summary string.
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
