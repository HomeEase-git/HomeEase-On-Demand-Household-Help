import type { RoomType } from '../types/booking4step.types';

export interface PriceRange {
  min: number;
  max: number;
}

export function estimateRange(range: PriceRange): PriceRange {
  return { min: round2(Math.max(0, range.min)), max: round2(Math.max(0, range.max)) };
}

export interface PricePointEstimate {
  laborCost: number;
  priceBreakdown: { basePrice: number; distanceFee: number; tierFee: number; rushFee?: number } | null;
  addOnsTotal: number;
  tip: number;
  subtotal: number;
  total: number;
}

export function estimatePricePoint(params: {
  laborCost: number;
  priceBreakdown?: { basePrice: number; distanceFee: number; tierFee: number; rushFee?: number } | null;
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
