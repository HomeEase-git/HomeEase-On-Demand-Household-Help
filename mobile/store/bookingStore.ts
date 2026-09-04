import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { bookingStorage } from '../utils/storage';
import { validateDraftForSubmit as validateDraftUtil } from '../utils/bookingValidation';
import { mapServiceToCategory } from '../utils/categoryMapping';
import type { ConditionType, RoomSelection, RoomType, ServiceScopeType, TimeSlot, UrgencyLevel, WorkerTier } from '../types/booking4step.types';

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
  | 'Cancelled';

// Backend BookingStatus enum -> store's friendly status values
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

export type Quote = {
  laborCost: number;
  materialsCost: number;
  totalAmount: number;
  notes: string;
  submittedAt: string;
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
  quote?: Quote;
  address?: string;
  time?: string;
  workerId?: string;
  workerPhone?: string;
  workerAvatar?: string;
  workerVerified?: boolean;
  completionPhotoUrl?: string | null;
  category?: string;
  selectedAddOnIds?: string[];
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
  tip?: number;
  taxRate?: number;
  selectedAddOnIds: string[];
  estimatedPrice: number;
  // True when the selected task's price is only an estimate until the
  // worker inspects the job and submits a quote (see utils/pricing.ts).
  quoteRequired?: boolean;
  // New metadata
  entrySource?: 'worker_profile' | 'new_booking' | 'book_again' | 're_offer' | null;
  workerLocked?: boolean;
  workerName?: string | null;
  // Every ServiceType the locked worker actually offers (id + name) — set
  // when entering via the worker profile's "Book Now". Step 1 uses this to
  // restrict the category picker to services this worker can perform, and
  // to resolve the matching serviceTypeId for whichever one is picked.
  workerServiceTypes?: { id: string; name: string }[] | null;
  lat?: number;
  lng?: number;
  lastInvalidationReason?: string | null;

  // ===== 4-step booking flow (Scope/Schedule/Who/Confirm) additions =====
  serviceType?: string | null; // ServiceType.name — sent to the backend as `serviceType`
  serviceTypeId?: string | null; // ServiceType.id — captured from the selected worker's card in Step 3, used to fetch that worker's packages for the selected category
  categoryBasePrice?: number | null; // ServiceType.basePrice — rate proxy for the pre-worker price range preview
  selectedPackageIds: string[]; // WorkerPackage ids selected in Step 4 — resolved to priced add-ons server-side
  rooms: RoomSelection[];
  condition: ConditionType | null;
  // Admin-configured scope for the selected category (ServiceType.scopeType/
  // hasCondition) — mirrored into the draft so later steps (price estimate,
  // Step 4 summary) don't need the full category list to know how to render.
  scopeType?: ServiceScopeType | null;
  hasCondition?: boolean;
  scopeAnswers?: Record<string, string | string[]>; // CUSTOM-scope answers, keyed by ScopeField.label
  issuePhotoUrls?: string[]; // photos of the issue the client attached in Step 1, uploaded via POST /bookings/issue-photo/upload
  timeSlot: TimeSlot | null;
  urgencyLevel: UrgencyLevel;
  priorities: string[]; // Step 4 submits ['Pet-friendly'] when the "I have pets" toggle is on; empty otherwise

  addOnToggles: string[]; // AddOnToggleKey[] — free preference toggles, sent as zero-priced addOns
  // Worker selected via Step 3 (WHO) — separate from workerId/workerName above,
  // which pre-date this flow and are still used by the "book from profile" /
  // "book again" entry points that lock a worker before Step 1.
  workerHourlyRate?: number | null;
  workerTier?: WorkerTier | null;
  workerEstimatedTotal?: number | null;
  workerAvatar?: string | null;
  workerRating?: number | null;
  isAutoMatched?: boolean;
  // Client-side-only "hold" countdown started the moment a worker is picked
  // in Step 3 — a UX affordance, not a real server-side reservation (the
  // backend has no pre-booking hold concept, only the 1-hour PENDING expiry
  // that starts once the booking is actually created).
  holdStartedAt?: number | null;
  // Generated once (see utils/idempotencyKey.ts) the first time this draft
  // is submitted, and persisted with the rest of the draft — so a retried
  // submission (including after the app was backgrounded/killed and
  // relaunched, since the draft is restored from storage) reuses the same
  // key instead of letting the backend create a duplicate booking. Cleared
  // whenever the draft resets (successful create, or a fresh "New Booking").
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
  estimatedPrice: number;
  finalPrice: number | null;
  rating: number | null;
};

// Maps the API's booking-list shape into the store's friendly `Booking` shape.
// Shared by any screen that hydrates `bookings` from GET /bookings.
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
    status: API_STATUS_MAP[b.status] ?? 'Pending',
    amount: b.finalPrice ?? b.estimatedPrice,
    rating: b.rating ?? undefined,
  };
}

// Shape of GET /bookings/:id (services/api.ts getBookingDetail()) this store
// needs to rebuild a full draft from — see prefillFromDeclinedBooking. A
// deliberately partial view of the real response (only what's carried
// forward), typed here rather than imported from the screen that owns the
// full ApiBookingDetail shape, to avoid a screen -> store -> screen import
// cycle.
export type DeclinedBookingDetail = {
  category?: string | null;
  description?: string | null;
  location?: string | null;
  city?: string | null;
  clientLat?: number | null;
  clientLng?: number | null;
  scheduledDate?: string | null;
  timeSlot?: TimeSlot | null;
  urgencyLevel?: UrgencyLevel | null;
  rooms?: RoomType[] | null;
  condition?: ConditionType | null;
  scopeAnswers?: Record<string, string | string[]> | null;
};

function tallyRooms(rooms: RoomType[]): RoomSelection[] {
  const counts = new Map<RoomType, number>();
  for (const room of rooms) counts.set(room, (counts.get(room) ?? 0) + 1);
  return Array.from(counts.entries()).map(([room, count]) => ({ room, count }));
}

export type BookingState = {
  bookings: Booking[];
  selectedBooking: Booking | null;
  draft: DraftBooking;
  invalidateSchedule: (reason: string) => void;
  invalidateWorker: (reason: string) => void;
  clearInvalidationReason: () => void;
  validateDraftForSubmit: () => { ok: boolean; errors: string[] };
  setBookings: (bookings: Booking[]) => void;
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
  // Quote flow actions
  submitQuote: (bookingId: string, quote: Quote) => void;
  approveQuote: (bookingId: string) => void;
  disputeQuote: (bookingId: string, reason: string) => void;
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
  tip: 0,
  taxRate: 0.12,
  selectedAddOnIds: [],
  estimatedPrice: 0,
  quoteRequired: false,
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
  selectedPackageIds: [],
  rooms: [],
  condition: null,
  urgencyLevel: 'STANDARD',
  scopeType: null,
  hasCondition: true,
  scopeAnswers: {},
  issuePhotoUrls: [],
  timeSlot: null,
  priorities: [],
  addOnToggles: [],
  workerHourlyRate: null,
  workerEstimatedTotal: null,
  workerAvatar: null,
  workerRating: null,
  isAutoMatched: false,
  holdStartedAt: null,
  idempotencyKey: null,
};

export const useBookingStore: UseBoundStore<StoreApi<BookingState>> = create<BookingState>((set, get) => ({
  bookings: [],
  selectedBooking: null,
  draft: initialDraft,

  setBookings: (bookings) => set({ bookings }),
  setSelectedBooking: (booking) => set({ selectedBooking: booking }),

  setDraft: (draft) =>
    set((s) => {
      const prev = s.draft;
      const updatedDraft = { ...s.draft, ...draft } as DraftBooking;

      // If service/category or address/city changed and downstream fields exist,
      // invalidate schedule and set a user-visible reason. Do not clear a newly
      // supplied date/time in the same update payload.
      const categoryChanged = draft.category && draft.category !== prev.category;
      const addressChanged = draft.address && draft.address !== prev.address;
      const cityChanged = draft.city && draft.city !== prev.city;
      const conditionChanged = draft.condition !== undefined && draft.condition !== prev.condition;
      const roomsChanged = draft.rooms !== undefined && draft.rooms !== prev.rooms;
      const clearingSchedule =
        (categoryChanged || addressChanged || cityChanged || conditionChanged || roomsChanged) &&
        (prev.date || prev.timeSlot || prev.workerId) &&
        draft.date === undefined &&
        draft.timeSlot === undefined &&
        draft.workerId === undefined;

      if (clearingSchedule) {
        updatedDraft.date = null;
        updatedDraft.timeSlot = null;
        if (!updatedDraft.workerLocked) {
          updatedDraft.workerId = null;
          updatedDraft.workerHourlyRate = null;
          updatedDraft.workerEstimatedTotal = null;
          updatedDraft.isAutoMatched = false;
          updatedDraft.holdStartedAt = null;
        }
        updatedDraft.lastInvalidationReason = 'Your service or address changed, so we cleared your date/time.';
      }

      // Changing the date/time slot after a specific worker was picked (Step 3)
      // invalidates that pick — the worker's availability/rate was matched
      // against the previous slot, not the new one.
      const dateChanged = draft.date !== undefined && draft.date !== prev.date;
      const slotChanged = draft.timeSlot !== undefined && draft.timeSlot !== prev.timeSlot;
      const clearingWorkerForNewSlot =
        (dateChanged || slotChanged) &&
        !updatedDraft.workerLocked &&
        prev.workerHourlyRate != null &&
        draft.workerId === undefined;

      if (clearingWorkerForNewSlot) {
        updatedDraft.workerId = null;
        updatedDraft.workerName = null;
        updatedDraft.workerHourlyRate = null;
        updatedDraft.workerEstimatedTotal = null;
        updatedDraft.isAutoMatched = false;
        updatedDraft.holdStartedAt = null;
        updatedDraft.lastInvalidationReason = "Your worker isn't confirmed for the new date/time, so we cleared your selection.";
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

  // Used when a booking is created directly via the backend API (e.g. step-3.tsx),
  // rather than through the local processPayment simulation.
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

  submitQuote: (bookingId, quote) =>
    set((state) => {
      const updatedBookings = state.bookings.map((b) =>
        b.id === bookingId
          ? { ...b, status: 'QuoteSubmitted' as BookingStatus, quote, amount: quote.totalAmount }
          : b,
      );
      const updatedSelected =
        state.selectedBooking?.id === bookingId
          ? { ...state.selectedBooking, status: 'QuoteSubmitted' as BookingStatus, quote, amount: quote.totalAmount }
          : state.selectedBooking;
      return { bookings: updatedBookings, selectedBooking: updatedSelected };
    }),

  approveQuote: (bookingId) =>
    set((state) => {
      const updatedBookings = state.bookings.map((b) =>
        b.id === bookingId
          ? { ...b, status: 'QuoteApproved' as BookingStatus }
          : b,
      );
      const updatedSelected =
        state.selectedBooking?.id === bookingId
          ? { ...state.selectedBooking, status: 'QuoteApproved' as BookingStatus }
          : state.selectedBooking;
      return { bookings: updatedBookings, selectedBooking: updatedSelected };
    }),

  disputeQuote: (bookingId, _reason) =>
    set((state) => {
      const updatedBookings = state.bookings.map((b) =>
        b.id === bookingId
          ? { ...b, status: 'Disputed' as BookingStatus }
          : b,
      );
      const updatedSelected =
        state.selectedBooking?.id === bookingId
          ? { ...state.selectedBooking, status: 'Disputed' as BookingStatus }
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
        selectedAddOnIds: booking.selectedAddOnIds ?? [],
        workerId: booking.workerId ?? null,
        entrySource: 'book_again',
        workerLocked: false,
        date: null,
        paymentMethod: null,
      };
      bookingStorage.saveDraft(updatedDraft);
      return { draft: updatedDraft };
    }),

  // A worker declining leaves the booking terminally REJECTED — there's no
  // reviving it, so this builds a fresh draft from its scope+schedule and
  // routes back through Step 1 (see the booking-detail screen's "Find
  // Another Pro"), rather than making the client re-enter everything.
  // Deliberately does NOT resolve serviceTypeId/categoryBasePrice/scopeType
  // here — Step 1's own category loader already does that name-match
  // lookup against the live catalog for a restored draft, so duplicating it
  // here would just be a second, driftable copy of the same logic.
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
        // scheduledDate is a full ISO datetime truncated to UTC midnight
        // server-side (see backend toDayStart) — the leading 10 chars are
        // its YYYY-MM-DD, matching what DateGridPicker/step-2 expect.
        date: detail.scheduledDate ? detail.scheduledDate.slice(0, 10) : null,
        timeSlot: detail.timeSlot ?? null,
        urgencyLevel: detail.urgencyLevel ?? 'STANDARD',
        rooms: detail.rooms ? tallyRooms(detail.rooms) : [],
        condition: detail.condition ?? null,
        scopeAnswers: detail.scopeAnswers ?? {},
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