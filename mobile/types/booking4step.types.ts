/**
 * Types for the 4-step booking flow (Scope -> Schedule -> Who -> Confirm),
 * matching the backend's Phase 1/2 schema+API additions (TimeSlot, RoomType,
 * ConditionType, worker discovery, auto-match booking creation).
 */

export const TIME_SLOTS = ['MORNING', 'AFTERNOON', 'EVENING'] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number];

export const TIME_SLOT_LABELS: Record<TimeSlot, string> = {
  MORNING: 'Morning',
  AFTERNOON: 'Afternoon',
  EVENING: 'Evening',
};

export const TIME_SLOT_WINDOWS: Record<TimeSlot, string> = {
  MORNING: '8am - 12pm',
  AFTERNOON: '12pm - 4pm',
  EVENING: '4pm - 8pm',
};

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

// Admin-configured booking "scope" step — every category is just an ordered
// list of these (Text / Select / Multi-select / Number), configured in the
// admin Service Catalog page. No special-cased room picker or condition
// toggle anymore; a category that wants either just defines them as
// ordinary fields.
export const SCOPE_FIELD_TYPES = ['TEXT', 'SELECT', 'MULTI_SELECT', 'NUMBER'] as const;
export type ScopeFieldType = (typeof SCOPE_FIELD_TYPES)[number];

export type ScopeFieldOption = {
  id: string;
  label: string;
};

export type ScopeField = {
  id: string;
  label: string;
  // Optional hint shown under the question.
  helpText?: string | null;
  fieldType: ScopeFieldType;
  required: boolean;
  options: ScopeFieldOption[];
  minValue?: number | null;
  maxValue?: number | null;
  // Jobs (ServiceTask ids) this question is asked for. Empty = every job.
  taskIds: string[];
};

/**
 * Whether a question is asked for the chosen job — mirrors the backend's
 * utils/scopeFields.fieldAppliesToTask. A question with no job links applies
 * to every job, and a per-unit job's own count question always applies.
 */
export function fieldAppliesToTask(
  field: Pick<ScopeField, 'id' | 'taskIds'>,
  task: { id: string; quantityScopeFieldId?: string | null } | null
): boolean {
  if (task && task.quantityScopeFieldId === field.id) return true;
  if (field.taskIds.length === 0) return true;
  return task ? field.taskIds.includes(task.id) : false;
}

// Condition is no longer a platform-wide booking input (a category that
// wants a condition-style question defines it as an ordinary field now) —
// these are kept only to render Booking.condition on historical bookings
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
  priceBreakdown: { basePrice: number; distanceFee: number; tierFee: number } | null;
  // Only populated when the search was scoped to a PER_UNIT task — this
  // worker's tier-adjusted rate, with no total (quantity isn't known to the
  // backend yet). estimatedTotal stays null in that case; use this instead.
  unitPrice: number | null;
  matchedServiceTypeId: string | null;
  badges: string[];
  openSlots: TimeSlot[];
  tier?: WorkerTier;
};

export const TASK_PRICING_MODELS = ['FIXED', 'PER_UNIT', 'TIERED', 'CUSTOM_QUOTE'] as const;
export type TaskPricingModel = (typeof TASK_PRICING_MODELS)[number];

// A specific bookable job within a category (e.g. "Toilet Repair" under
// "Plumbing Repair"), priced by the admin — basePrice is the same at every
// pro (before their tier surcharge and distance fee). minPrice/maxPrice both
// carry that price for the estimate preview; both null for CUSTOM_QUOTE
// (worker quotes on-site, no upfront price at all).
export type ServiceTaskOption = {
  id: string;
  name: string;
  description?: string | null;
  basePrice: number;
  pricingModel: TaskPricingModel;
  minPrice: number | null;
  maxPrice: number | null;
  unitLabel: string | null;
  quantityScopeFieldId: string | null;
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
  timeSlot: TimeSlot;
  addOns?: BookingAddOnInput[];
  packageIds?: string[];
  priorities?: string[];
  tip?: number;
  notes?: string;
  paymentMethodType?: 'GCASH' | 'MAYA' | 'CASH';
  paymentAccountIdentifier?: string;
  scopeAnswers?: Record<string, string | string[]>;
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
  timeSlot: TimeSlot;
  estimatedPrice: number;
  estimatedDurationHours: number | null;
  expiresAt: string;
  pricing: {
    basePrice: number;
    conditionFee: number;
    distanceFee: number;
    urgencyFee: number;
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
// (see bookingController `hasPets`). Step 4 collects this as a single
// toggle and submits this constant when it's on.
export const PET_FRIENDLY_PRIORITY = 'Pet-friendly';

// Multi-day upfront booking (see backend bookingController.
// createMultiDayBooking) — books the SAME worker for N consecutive days.
// Only reachable when a worker is already locked in (draft.workerLocked),
// since there's no auto-match here; no addOns/packageIds/tip for this first
// version (see the backend docblock for why).
export type CreateMultiDayBookingPayload = {
  workerId: string;
  serviceType: string;
  serviceTaskId?: string | null;
  description?: string;
  address: string;
  city?: string;
  lat: number;
  lng: number;
  startDate: string;
  dayCount: number;
  timeSlot: TimeSlot;
  priorities?: string[];
  notes?: string;
  paymentMethodType?: 'GCASH' | 'MAYA' | 'CASH';
  paymentAccountIdentifier?: string;
  scopeAnswers?: Record<string, string | string[]>;
  issuePhotoUrls?: string[];
  idempotencyKey?: string;
};

export type CreateMultiDayBookingResponse = {
  groupId: string;
  totalDays: number;
  bookings: {
    id: string;
    scheduledDate: string;
    timeSlot: TimeSlot;
    status: string;
    estimatedPrice: number;
    expiresAt: string;
  }[];
  totalEstimatedPrice: number;
};

export type AddOnToggleKey = 'eco_friendly' | 'client_supplies' | 'call_before_arrival';

export const ADD_ON_TOGGLES: Array<{ key: AddOnToggleKey; label: string; description: string }> = [
  {
    key: 'eco_friendly',
    label: 'Eco-Friendly Products',
    description: 'Worker uses non-toxic, environmentally-friendly cleaning products',
  },
  {
    key: 'client_supplies',
    label: 'Client-Provided Supplies',
    description: "I'll provide my own cleaning supplies and equipment",
  },
  {
    key: 'call_before_arrival',
    label: 'Call Before Arrival',
    description: 'Worker calls 15-30 minutes before arriving',
  },
];

export const ADD_ON_TOGGLE_LABELS: Record<AddOnToggleKey, string> = {
  eco_friendly: 'Eco-Friendly Products',
  client_supplies: 'Client-Provided Supplies',
  call_before_arrival: 'Call Before Arrival',
};
