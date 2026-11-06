import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { bookingStorage } from '../utils/storage';
import { validateDraftForSubmit as validateDraftUtil } from '../utils/bookingValidation';
import { mapServiceToCategory } from '../utils/categoryMapping';
import { getBookingsPage } from '../services/api';
import { hasMorePages, uniqueNew } from '../utils/pagination';
import type { TimeSlot, WorkerTier } from '../types/booking4step.types';
import { bookingStartTime } from '../utils/bookingTime';

export type BookingStatus =
  | 'Pending'
  | 'Accepted'
  | 'InProgress'
  | 'QuoteSubmitted'
  | 'QuoteApproved'
  | 'Disputed'
  | 'PendingCompletion'
  | 'AwaitingPayment'
  | 'Completed'
  | 'Cancelled'
  | 'Declined';

export const API_STATUS_MAP: Record<string, BookingStatus> = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  REJECTED: 'Cancelled',
  IN_PROGRESS: 'InProgress',
  QUOTE_SUBMITTED: 'QuoteSubmitted',
  QUOTE_APPROVED: 'QuoteApproved',
  DISPUTED: 'Disputed',
  PENDING_COMPLETION: 'PendingCompletion',
  AWAITING_PAYMENT: 'AwaitingPayment',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export type BookingPayment = {
  methodType: string;
  accountIdentifier?: string;
  status?: string;
  totalAmount?: number;
};

export type Booking = {
  id: string;
  service: string;
  worker: string;
  date: string;
  status: BookingStatus;
  amount: number;
  payment?: BookingPayment;
  rating?: number;
  reviewText?: string;
  address?: string;
  time?: string;
  workerId?: string;
  workerPhone?: string;
  workerAvatar?: string;
  workerVerified?: boolean;
  completionPhotoUrl?: string | null;
  category?: string;
  rescheduledAt?: string | null;
  previousScheduledDate?: string | null;
  previousTimeSlot?: string | null;
  originalScheduledDate?: string | null;
  rescheduleAcknowledgedAt?: string | null;
  workerNoShowFlaggedAt?: string | null;
  // Same-day booking with the rush fee.
  isRush?: boolean;
  priceBreakdown?: {
    basePrice: number | null;
    distanceFee: number;
    tierFee: number;
    rushFee?: number;
    addOns: { name: string; price: number }[];
    subtotal: number;
    vatApplicable: boolean;
    vatRate: number | null;
    vatAmount: number;
    tip: number;
    total: number;
  } | null;
  groupId?: string | null;
  groupTotalDays?: number | null;
  groupDayIndex?: number | null;
};

export type DraftBooking = {
  category: string | null;
  description: string;
  address: string | null;
  city?: string;
  date: string | null;
  instructions?: string;
  notes?: string;
  workerId: string | null;
  paymentMethod: string | null;
  paymentAccountIdentifier?: string | null;
  tip?: number;
  taxRate?: number;
  estimatedPrice: number;
  // New metadata
  entrySource?: 'worker_profile' | 'new_booking' | 'book_again' | 're_offer' | null;
  workerLocked?: boolean;
  workerName?: string | null;
  workerServiceTypes?: { id: string; name: string; priceRangeMin?: number; priceRangeMax?: number }[] | null;
  lat?: number;
  lng?: number;
  lastInvalidationReason?: string | null;

  serviceType?: string | null;
  serviceTypeId?: string | null;
  categoryBasePrice?: number | null;
  categoryPriceRangeMin?: number | null;
  categoryPriceRangeMax?: number | null;
  serviceTaskId?: string | null;
  selectedTaskName?: string | null;
  selectedTaskPricingModel?: 'FIXED' | 'PER_UNIT' | 'TIERED' | null;
  selectedTaskUnitLabel?: string | null;
  selectedTaskPriceRangeMin?: number | null;
  selectedTaskPriceRangeMax?: number | null;
  selectedTaskMinQuantity?: number | null;
  selectedTaskMaxQuantity?: number | null;
  selectedPackageIds: string[];
  selectedPackagesTotal?: number;
  quantity?: number | null; // how many units, for a per-unit task (Step 1)
  issuePhotoUrls?: string[];
  time: string | null;
  parentBookingId?: string | null;
  priorities: string[];

  addOnToggles: string[];
  workerTier?: WorkerTier | null;
  workerEstimatedTotal?: number | null;
  workerPriceBreakdown?: { basePrice: number; distanceFee: number; tierFee: number; rushFee?: number } | null;
  workerUnitPrice?: number | null;
  workerAvatar?: string | null;
  workerRating?: number | null;
  isAutoMatched?: boolean;
  holdStartedAt?: number | null;
  idempotencyKey?: string | null;
};

export type ApiBookingListItem = {
  id: string;
  workerName: string | null;
  workerId: string | null;
  workerPhone: string | null;
  workerAvatar: string | null;
  workerVerified: boolean | null;
  service: string;
  category?: string;
  status: string;
  scheduledDate: string;
  scheduledTime?: string | null;
  timeSlot?: string | null;
  isRush?: boolean;
  estimatedPrice: number;
  finalPrice: number | null;
  rating: number | null;
  groupId?: string | null;
  groupTotalDays?: number | null;
  groupDayIndex?: number | null;
};

export function mapApiBooking(b: ApiBookingListItem): Booking {
  return {
    id: b.id,
    service: b.service,
    category: b.category ?? undefined,
    worker: b.workerName ?? 'Unassigned',
    workerId: b.workerId ?? undefined,
    workerPhone: b.workerPhone ?? undefined,
    workerAvatar: b.workerAvatar ?? undefined,
    workerVerified: b.workerVerified ?? undefined,
    date: b.scheduledDate,
    time: bookingStartTime(b) ?? undefined,
    isRush: b.isRush ?? false,
    status: b.status === 'REJECTED' ? 'Declined' : (API_STATUS_MAP[b.status] ?? 'Pending'),
    amount: b.finalPrice ?? b.estimatedPrice,
    rating: b.rating ?? undefined,
    groupId: b.groupId ?? undefined,
    groupTotalDays: b.groupTotalDays ?? undefined,
    groupDayIndex: b.groupDayIndex ?? undefined,
  };
}

export type DeclinedBookingDetail = {
  category?: string | null;
  description?: string | null;
  location?: string | null;
  city?: string | null;
  clientLat?: number | null;
  clientLng?: number | null;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  timeSlot?: TimeSlot | null;
  quantity?: number | null;
};

export type BookingState = {
  bookings: Booking[];
  selectedBooking: Booking | null;
  draft: DraftBooking;
  invalidateSchedule: (reason: string) => void;
  invalidateWorker: (reason: string) => void;
  clearInvalidationReason: () => void;
  validateDraftForSubmit: () => { ok: boolean; errors: string[] };
  setBookings: (bookings: Booking[]) => void;
  bookingsPage: number;
  bookingsHasMore: boolean;
  bookingsLoadingMore: boolean;
  loadBookings: () => Promise<void>;
  refreshBookings: () => Promise<void>;
  loadMoreBookings: () => Promise<void>;
  setSelectedBooking: (booking: Booking | null) => void;
  setDraft: (draft: Partial<DraftBooking>) => void;
  clearDraft: () => void;
  setCurrentBooking: (booking: Booking) => void;
  setBookingCreated: (booking: Booking) => void;
  updateBookingStatus: (id: string, status: BookingStatus) => void;
  submitReview: (bookingId: string, rating: number, comment: string) => void;
  restoreDraft: () => Promise<void>;
  prefillFromBooking: (booking: Booking) => void;
  prefillFromDeclinedBooking: (detail: DeclinedBookingDetail) => void;
  acknowledgeReschedule: (bookingId: string) => void;
};

const initialDraft: DraftBooking = {
  category: null,
  description: '',
  address: null,
  city: '',
  date: null,
  instructions: '',
  notes: '',
  workerId: null,
  paymentMethod: null,
  paymentAccountIdentifier: null,
  tip: 0,
  taxRate: 0.12,
  estimatedPrice: 0,
  entrySource: null,
  workerLocked: false,
  workerName: null,
  workerServiceTypes: null,
  lat: undefined,
  lng: undefined,
  lastInvalidationReason: null,

  serviceType: null,
  serviceTypeId: null,
  categoryBasePrice: null,
  categoryPriceRangeMin: null,
  categoryPriceRangeMax: null,
  serviceTaskId: null,
  selectedTaskName: null,
  selectedTaskPricingModel: null,
  selectedTaskUnitLabel: null,
  selectedTaskMinQuantity: null,
  selectedTaskMaxQuantity: null,
  selectedTaskPriceRangeMin: null,
  selectedTaskPriceRangeMax: null,
  selectedPackageIds: [],
  selectedPackagesTotal: 0,
  quantity: null,
  issuePhotoUrls: [],
  time: null,
  parentBookingId: null,
  priorities: [],
  addOnToggles: [],
  workerEstimatedTotal: null,
  workerPriceBreakdown: null,
  workerUnitPrice: null,
  workerAvatar: null,
  workerRating: null,
  isAutoMatched: false,
  holdStartedAt: null,
  idempotencyKey: null,
};

const SUBMITTED_FIELDS = [
  'workerId',
  'isAutoMatched',
  'serviceTaskId',
  'description',
  'quantity',
  'issuePhotoUrls',
  'selectedPackageIds',
  'addOnToggles',
  'priorities',
  'tip',
  'paymentMethod',
  'paymentAccountIdentifier',
] as const satisfies readonly (keyof DraftBooking)[];

export const useBookingStore: UseBoundStore<StoreApi<BookingState>> = create<BookingState>((set, get) => ({
  bookings: [],
  bookingsPage: 1,
  bookingsHasMore: false,
  bookingsLoadingMore: false,
  selectedBooking: null,
  draft: initialDraft,

  setBookings: (bookings) => set({ bookings }),

  loadBookings: async () => {
    const { bookings, pagination } = await getBookingsPage(1);
    set({
      bookings: (bookings as ApiBookingListItem[]).map(mapApiBooking),
      bookingsPage: 1,
      bookingsHasMore: hasMorePages(pagination),
    });
  },

  refreshBookings: async () => {
    try {
      await get().loadBookings();
    } catch (error) {
      console.error('Refresh bookings error:', error);
    }
  },

  loadMoreBookings: async () => {
    const { bookingsHasMore, bookingsLoadingMore, bookingsPage: page } = get();
    if (!bookingsHasMore || bookingsLoadingMore) return;
    set({ bookingsLoadingMore: true });
    try {
      const { bookings, pagination } = await getBookingsPage(page + 1);
      if (get().bookingsPage !== page) return;
      const next = (bookings as ApiBookingListItem[]).map(mapApiBooking);
      set((s) => ({
        bookings: [...s.bookings, ...uniqueNew(next, s.bookings)],
        bookingsPage: page + 1,
        bookingsHasMore: hasMorePages(pagination),
      }));
    } catch (error) {
      console.error('Load more bookings error:', error);
    } finally {
      set({ bookingsLoadingMore: false });
    }
  },

  setSelectedBooking: (booking) => set({ selectedBooking: booking }),

  setDraft: (draft) =>
    set((s) => {
      const prev = s.draft;
      const updatedDraft = { ...s.draft, ...draft } as DraftBooking;

      const categoryChanged = draft.category && draft.category !== prev.category;
      const addressChanged = draft.address && draft.address !== prev.address;
      const cityChanged = draft.city && draft.city !== prev.city;
      const clearingSchedule =
        (categoryChanged || addressChanged || cityChanged) &&
        (prev.date || prev.time || prev.workerId) &&
        draft.date === undefined &&
        draft.time === undefined &&
        draft.workerId === undefined;

      if (clearingSchedule) {
        updatedDraft.date = null;
        updatedDraft.time = null;
        if (!updatedDraft.workerLocked) {
          updatedDraft.workerId = null;
          updatedDraft.workerEstimatedTotal = null;
          updatedDraft.workerPriceBreakdown = null;
          updatedDraft.workerUnitPrice = null;
          updatedDraft.isAutoMatched = false;
          updatedDraft.holdStartedAt = null;
        }
        updatedDraft.lastInvalidationReason = 'Your service or address changed, so we cleared your date/time.';
      }

      const dateChanged = draft.date !== undefined && draft.date !== prev.date;
      const slotChanged = draft.time !== undefined && draft.time !== prev.time;
      const scopeChanged =
        (draft.serviceTaskId !== undefined && draft.serviceTaskId !== prev.serviceTaskId) ||
        (draft.quantity !== undefined && draft.quantity !== prev.quantity);
      const clearingWorkerForNewSlot =
        (dateChanged || scopeChanged) &&
        !updatedDraft.workerLocked &&
        prev.workerId != null &&
        draft.workerId === undefined;

      if (clearingWorkerForNewSlot) {
        updatedDraft.workerId = null;
        updatedDraft.workerName = null;
        updatedDraft.workerEstimatedTotal = null;
        updatedDraft.workerPriceBreakdown = null;
        updatedDraft.workerUnitPrice = null;
        updatedDraft.isAutoMatched = false;
        updatedDraft.holdStartedAt = null;
        updatedDraft.lastInvalidationReason = dateChanged
          ? "Your worker isn't confirmed for the new date/time, so we cleared your selection."
          : "Your job details changed, so please pick your worker again.";
      }

      const payloadChanged = SUBMITTED_FIELDS.some(
        (f) => f in draft && JSON.stringify(draft[f]) !== JSON.stringify(prev[f]),
      );
      if (
        (categoryChanged || addressChanged || cityChanged || dateChanged || slotChanged || payloadChanged) &&
        prev.idempotencyKey &&
        draft.idempotencyKey === undefined
      ) {
        updatedDraft.idempotencyKey = null;
      }

      const updated = { draft: updatedDraft };
      bookingStorage.saveDraft(updated.draft);
      return updated;
    }),

  invalidateSchedule: (reason) =>
    set((state) => {
      const draft = { ...state.draft };
      draft.date = null;
      if (!draft.workerLocked) draft.workerId = null;
      draft.lastInvalidationReason = reason;
      bookingStorage.saveDraft(draft);
      return { draft };
    }),

  invalidateWorker: (reason) =>
    set((state) => {
      const draft = { ...state.draft };
      if (!draft.workerLocked) draft.workerId = null;
      draft.lastInvalidationReason = reason;
      bookingStorage.saveDraft(draft);
      return { draft };
    }),

  clearInvalidationReason: () => set((state) => ({ draft: { ...state.draft, lastInvalidationReason: null } })),

  validateDraftForSubmit: (): { ok: boolean; errors: string[] } => validateDraftUtil(get().draft),

  clearDraft: async () => {
    set({ draft: initialDraft });
    await bookingStorage.clearDraft();
  },

  setCurrentBooking: (booking) => set({ selectedBooking: booking }),

  setBookingCreated: (booking) =>
    set((state) => {
      const nextBookings = [...state.bookings, booking];
      bookingStorage.clearDraft();
      return {
        bookings: nextBookings,
        selectedBooking: booking,
        draft: initialDraft,
      };
    }),

  updateBookingStatus: (id, status) =>
    set((state) => {
      const updatedBookings = state.bookings.map((b) =>
        b.id === id ? { ...b, status } : b,
      );
      const updatedSelected =
        state.selectedBooking?.id === id
          ? { ...state.selectedBooking, status }
          : state.selectedBooking;
      return { bookings: updatedBookings, selectedBooking: updatedSelected };
    }),

  acknowledgeReschedule: (bookingId) =>
    set((state) => {
      const acknowledgedAt = new Date().toISOString();
      const updatedBookings = state.bookings.map((b) =>
        b.id === bookingId ? { ...b, rescheduleAcknowledgedAt: acknowledgedAt } : b,
      );
      const updatedSelected =
        state.selectedBooking?.id === bookingId
          ? { ...state.selectedBooking, rescheduleAcknowledgedAt: acknowledgedAt }
          : state.selectedBooking;
      return { bookings: updatedBookings, selectedBooking: updatedSelected };
    }),

  submitReview: (bookingId, rating, comment) =>
    set((state) => {
      const updatedBookings = state.bookings.map((b) =>
        b.id === bookingId ? { ...b, rating, reviewText: comment } : b,
      );
      const updatedSelected =
        state.selectedBooking?.id === bookingId
          ? { ...state.selectedBooking, rating, reviewText: comment }
          : state.selectedBooking;
      return { bookings: updatedBookings, selectedBooking: updatedSelected };
    }),

  restoreDraft: async () => {
    const savedDraft = await bookingStorage.getDraft();
    if (savedDraft) {
      const restoredDraft: DraftBooking = { ...initialDraft, ...savedDraft };
      set({ draft: restoredDraft });
    }
  },

  prefillFromBooking: (booking) =>
    set(() => {
      const resolvedCategory = booking.category ?? mapServiceToCategory(booking.service) ?? null;
      const updatedDraft: DraftBooking = {
        ...initialDraft,
        category: resolvedCategory,
        address: booking.address ?? null,
        workerId: booking.workerId ?? null,
        entrySource: 'book_again',
        workerLocked: false,
        date: null,
        paymentMethod: null,
      };
      bookingStorage.saveDraft(updatedDraft);
      return { draft: updatedDraft };
    }),

  prefillFromDeclinedBooking: (detail) =>
    set(() => {
      const updatedDraft: DraftBooking = {
        ...initialDraft,
        category: detail.category ?? null,
        serviceType: detail.category ?? null,
        description: detail.description ?? '',
        address: detail.location ?? null,
        city: detail.city ?? '',
        lat: detail.clientLat ?? undefined,
        lng: detail.clientLng ?? undefined,
        date: detail.scheduledDate ? detail.scheduledDate.slice(0, 10) : null,
        time: bookingStartTime(detail),
        quantity: detail.quantity ?? null,
        entrySource: 're_offer',
        workerLocked: false,
        workerId: null,
        isAutoMatched: false,
        paymentMethod: null,
      };
      bookingStorage.saveDraft(updatedDraft);
      return { draft: updatedDraft };
    }),
}));