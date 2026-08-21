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

// Admin-configured booking "scope" step (see ServiceType.scopeType on the
// backend) — ROOM_BASED shows the room picker below; CUSTOM shows
// admin-defined ScopeField[] instead (e.g. "Appliance Type" for Appliance
// Repair, since rooms/quantity don't make sense for every category).
export const SERVICE_SCOPE_TYPES = ['ROOM_BASED', 'CUSTOM'] as const;
export type ServiceScopeType = (typeof SERVICE_SCOPE_TYPES)[number];

export const SCOPE_FIELD_TYPES = ['TEXT', 'SELECT', 'MULTI_SELECT'] as const;
export type ScopeFieldType = (typeof SCOPE_FIELD_TYPES)[number];

export type ScopeFieldOption = {
  id: string;
  label: string;
};

export type ScopeField = {
  id: string;
  label: string;
  fieldType: ScopeFieldType;
  required: boolean;
  options: ScopeFieldOption[];
};

export const CONDITION_TYPES = ['TIDY', 'NORMAL', 'HEAVY'] as const;
export type ConditionType = (typeof CONDITION_TYPES)[number];

export const CONDITION_LABELS: Record<ConditionType, string> = {
  TIDY: 'Tidy',
  NORMAL: 'Normal',
  HEAVY: 'Heavy',
};

export const CONDITION_MULTIPLIER: Record<ConditionType, number> = {
  TIDY: 0.8,
  NORMAL: 1.0,
  HEAVY: 1.6,
};

export const CONDITION_DESCRIPTIONS: Record<ConditionType, string> = {
  TIDY: 'Lightly used, minimal mess',
  NORMAL: 'Everyday household mess',
  HEAVY: 'Heavily soiled or neglected',
};

export const WORKER_TIERS = ['STANDARD', 'PRO', 'EXPERT'] as const;
export type WorkerTier = (typeof WORKER_TIERS)[number];

// Mirrors backend utils/workerTier.ts default multipliers — actual values
// are admin-configurable via AppSettings; this is only a client-side preview
// default, the server recomputes authoritatively at booking creation.
export const TIER_MULTIPLIER: Record<WorkerTier, number> = {
  STANDARD: 1.0,
  PRO: 1.15,
  EXPERT: 1.3,
};

export const URGENCY_LEVELS = ['STANDARD', 'URGENT', 'EMERGENCY'] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export const URGENCY_LABELS: Record<UrgencyLevel, string> = {
  STANDARD: 'Standard',
  URGENT: 'Urgent',
  EMERGENCY: 'Emergency',
};

export const URGENCY_DESCRIPTIONS: Record<UrgencyLevel, string> = {
  STANDARD: 'No rush — regular scheduling',
  URGENT: 'Needed as soon as possible',
  EMERGENCY: 'Immediate attention needed',
};

// Mirrors backend URGENCY_FEE_MULTIPLIER in bookingController.ts — surcharge
// applied on top of the category base price for faster turnaround.
export const URGENCY_MODIFIER: Record<UrgencyLevel, number> = {
  STANDARD: 1.0,
  URGENT: 1.15,
  EMERGENCY: 1.3,
};

/** Selected room + how many of that room type (e.g. 2 bedrooms). */
export type RoomSelection = {
  room: RoomType;
  count: number;
};

export type WorkerCard = {
  id: string;
  fullName: string;
  avatar: string | null;
  rating: number;
  totalReviews: number;
  hourlyRate: number | null;
  estimatedTotal: number | null;
  matchedServiceTypeId: string | null;
  badges: string[];
  openSlots: TimeSlot[];
  tier?: WorkerTier;
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
  rooms?: RoomType[];
  condition?: ConditionType | null;
  description?: string;
  address: string;
  city?: string;
  lat: number;
  lng: number;
  date: string;
  timeSlot: TimeSlot;
  urgencyLevel?: UrgencyLevel;
  addOns?: BookingAddOnInput[];
  packageIds?: string[];
  priorities?: string[];
  tip?: number;
  notes?: string;
  paymentMethodType?: 'GCASH' | 'MAYA' | 'CASH';
  paymentAccountIdentifier?: string;
  scopeAnswers?: Record<string, string | string[]>;
  issuePhotoUrls?: string[];
};

export type CreateBookingResponse = {
  id: string;
  clientName: string;
  workerName: string | null;
  isAutoMatched: boolean;
  status: string;
  scheduledDate: string;
  timeSlot: TimeSlot;
  urgencyLevel: UrgencyLevel;
  estimatedPrice: number;
  estimatedDurationHours: number | null;
  expiresAt: string;
  pricing: {
    basePrice: number;
    conditionFee: number;
    distanceFee: number;
    urgencyFee: number;
    addOnsTotal: number;
    finalEstimate: number;
  };
  payment: {
    id: string;
    status: string;
    escrowStatus: string;
    clientSecret: string | null;
  };
};

export const PRIORITY_OPTIONS = [
  'Eco-friendly',
  'Detail-oriented',
  'Fast service',
  'Pet-friendly',
  'Budget-conscious',
  'Experienced pro',
] as const;

export const MAX_PRIORITIES = 3;

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
