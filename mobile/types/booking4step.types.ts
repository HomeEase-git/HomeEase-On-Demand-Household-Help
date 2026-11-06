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
  priceBreakdown: { basePrice: number; distanceFee: number; tierFee: number; rushFee?: number } | null;
  unitPrice: number | null;
  matchedServiceTypeId: string | null;
  badges: string[];
  tier?: WorkerTier;
  rushFeeRate?: number;
  yearsExperience?: number | null;
};

export const TASK_PRICING_MODELS = ['FIXED', 'PER_UNIT', 'TIERED'] as const;
export type TaskPricingModel = (typeof TASK_PRICING_MODELS)[number];

export type ServiceTaskOption = {
  id: string;
  name: string;
  description?: string | null;
  basePrice: number;
  pricingModel: TaskPricingModel;
  minPrice: number | null;
  maxPrice: number | null;
  unitLabel: string | null;
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
  payment: null;
};

export const PET_FRIENDLY_PRIORITY = 'Pet-friendly';

