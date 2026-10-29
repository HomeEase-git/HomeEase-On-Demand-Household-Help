/**
 * Types for the 4-step booking flow (Scope -> Schedule -> Who -> Confirm),
 * matching the backend's API (RoomType, ConditionType, worker discovery,
 * auto-match booking creation). Bookings are scheduled by date plus an exact
 * start time "HH:00" — see utils/bookingTime.ts.
 */

// Retired Morning/Afternoon/Evening slots — only read to show bookings made
// before exact start times.
export type TimeSlot = 'MORNING' | 'AFTERNOON' | 'EVENING';

export const ROOM_TYPES = [
  'BEDROOM',
  'BATHROOM',
  'KITCHEN',
  'LIVING_ROOM',
  'DINING_ROOM',
  'OFFICE',
  'GARAGE',
  'BALCONY',
  'OTHER',
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  BEDROOM: 'Bedroom',
  BATHROOM: 'Bathroom',
  KITCHEN: 'Kitchen',
  LIVING_ROOM: 'Living Room',
  DINING_ROOM: 'Dining Room',
  OFFICE: 'Office',
  GARAGE: 'Garage',
  BALCONY: 'Balcony',
  OTHER: 'Hallway',
};

// Condition is no longer a booking input — these are kept only to render Booking.condition on historical bookings
// created before this change.
export const CONDITION_TYPES = ['TIDY', 'NORMAL', 'HEAVY'] as const;
export type ConditionType = (typeof CONDITION_TYPES)[number];

export const CONDITION_LABELS: Record<ConditionType, string> = {
  TIDY: 'Tidy',
  NORMAL: 'Normal',
  HEAVY: 'Heavy',
};

export const WORKER_TIERS = ['STANDARD', 'PRO', 'EXPERT'] as const;
export type WorkerTier = (typeof WORKER_TIERS)[number];

export type WorkerCard = {
  id: string;
  fullName: string;
  avatar: string | null;
  rating: number;
  totalReviews: number;
  estimatedTotal: number | null;
  // Itemized version of estimatedTotal (same null conditions) — lets the
  // booking flow show Base rate / Distance fee / Tier surcharge as separate
  // lines instead of one lumped number.
  priceBreakdown: { basePrice: number; distanceFee: number; tierFee: number; rushFee?: number } | null;
  // Only populated when the search was scoped to a PER_UNIT task — this
  // worker's tier-adjusted rate, with no total (quantity isn't known to the
  // backend yet). estimatedTotal stays null in that case; use this instead.
  unitPrice: number | null;
  matchedServiceTypeId: string | null;
  badges: string[];
  tier?: WorkerTier;
  // Same-day search: the share of the service price added as the rush fee
  // (0 otherwise) — for the per-unit estimate.
  rushFeeRate?: number;
  yearsExperience?: number | null;
};

// TIERED is retired (charged like PER_UNIT); custom quotes are gone.
export const TASK_PRICING_MODELS = ['FIXED', 'PER_UNIT', 'TIERED'] as const;
export type TaskPricingModel = (typeof TASK_PRICING_MODELS)[number];

// A specific bookable job within a category (e.g. "Toilet Repair" under
// "Plumbing Repair"), priced by the admin — basePrice is the same at every
// worker (before their tier surcharge and distance fee). minPrice/maxPrice
// both carry that price for the estimate preview.
export type ServiceTaskOption = {
  id: string;
  name: string;
  description?: string | null;
  basePrice: number;
  pricingModel: TaskPricingModel;
  minPrice: number | null;
  maxPrice: number | null;
  unitLabel: string | null;
  // Per-unit only: the fewest/most units a client can book (null = 1 / no maximum).
  minQuantity: number | null;
  maxQuantity: number | null;
  isActive: boolean;
};

export type BookingAddOnInput = {
  id?: string;
  name: string;
  price: number;
};

export type CreateBookingPayload = {
  workerId?: string | null;
  serviceType: string;
  serviceTaskId?: string | null;
  description?: string;
  address: string;
  city?: string;
  lat: number;
  lng: number;
  date: string;
  time: string; // "HH:00", PH local
  // Follow-up job after an inspection/diagnosis booking (same worker).
  parentBookingId?: string | null;
  addOns?: BookingAddOnInput[];
  packageIds?: string[];
  priorities?: string[];
  tip?: number;
  notes?: string;
  paymentMethodType?: 'GCASH' | 'MAYA' | 'CASH';
  paymentAccountIdentifier?: string;
  // How many units, for a per-unit job.
  quantity?: number | null;
  issuePhotoUrls?: string[];
  idempotencyKey?: string;
};

export type CreateBookingResponse = {
  id: string;
  clientName: string;
  workerName: string | null;
  isAutoMatched: boolean;
  status: string;
  scheduledDate: string;
  scheduledTime: string;
  isRush: boolean;
  parentBookingId?: string | null;
  estimatedPrice: number;
  estimatedDurationHours: number | null;
  expiresAt: string;
  pricing: {
    basePrice: number;
    conditionFee: number;
    distanceFee: number;
    urgencyFee: number;
    rushFee: number;
    tierFee: number;
    addOnsTotal: number;
    finalEstimate: number;
    addOns: { name: string; price: number }[];
  };
  // No Payment row exists yet at booking-creation time — the client pays
  // after the job is completed (see backend bookingController.createBooking).
  payment: null;
};

// The only booking "priority" the backend acts on: any priority string
// containing "pet" flips the auto-match filter to pet-friendly workers
// (see bookingController `hasPets`). Step 1 collects this as a single
// toggle and submits this constant when it's on.
export const PET_FRIENDLY_PRIORITY = 'Pet-friendly';

