import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { bookings as dummyBookings } from '../constants/dummyData';
import { bookingStorage } from '../utils/storage';
import { isValidHHmm, TimeHHmm } from '../utils/time';
import { validateDraftForSubmit as validateDraftUtil } from '../utils/bookingValidation';
import { mapServiceToCategory } from '../utils/categoryMapping';

export type BookingStatus =
  | 'Pending'
  | 'Accepted'
  | 'Active'
  | 'InProgress'
  | 'QuoteSubmitted'
  | 'QuoteApproved'
  | 'Disputed'
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
  category?: string;
  selectedTaskId?: string;
  selectedAddOnIds?: string[];
};

export type DraftBooking = {
  category: string | null;
  description: string;
  address: string | null;
  city?: string;
  date: string | null;
  time: TimeHHmm | null;
  instructions?: string;
  notes?: string;
  workerId: string | null;
  paymentMethod: string | null;
  tip?: number;
  taxRate?: number;
  selectedTaskId: string | null;
  selectedAddOnIds: string[];
  estimatedPrice: number;
  // New metadata
  entrySource?: 'worker_profile' | 'new_booking' | 'book_again' | null;
  workerLocked?: boolean;
  workerName?: string | null;
  lat?: number;
  lng?: number;
  lastInvalidationReason?: string | null;
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
  setSelectedBooking: (booking: Booking | null) => void;
  setDraft: (draft: Partial<DraftBooking>) => void;
  clearDraft: () => void;
  setCurrentBooking: (booking: Booking) => void;
  setBookingCreated: (booking: Booking) => void;
  updateBookingStatus: (id: string, status: BookingStatus) => void;
  submitReview: (bookingId: string, rating: number, comment: string) => void;
  restoreDraft: () => Promise<void>;
  prefillFromBooking: (booking: Booking) => void;
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
  time: null,
  instructions: '',
  notes: '',
  workerId: null,
  paymentMethod: null,
  tip: 0,
  taxRate: 0.12,
  selectedTaskId: null,
  selectedAddOnIds: [],
  estimatedPrice: 0,
  entrySource: null,
  workerLocked: false,
  workerName: null,
  lat: undefined,
  lng: undefined,
  lastInvalidationReason: null,
};

export const useBookingStore: UseBoundStore<StoreApi<BookingState>> = create<BookingState>((set, get) => ({
  bookings: [...dummyBookings] as unknown as Booking[],
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
      const clearingSchedule =
        (categoryChanged || addressChanged || cityChanged) &&
        (prev.date || prev.time || prev.workerId) &&
        draft.date === undefined &&
        draft.time === undefined &&
        draft.workerId === undefined;

      if (clearingSchedule) {
        updatedDraft.date = null;
        updatedDraft.time = null;
        if (!updatedDraft.workerLocked) updatedDraft.workerId = null;
        updatedDraft.lastInvalidationReason = 'Your service or address changed, so we cleared your date/time.';
      }

      // Ensure time is either null or valid HH:mm
      if (updatedDraft.time && !isValidHHmm(updatedDraft.time)) {
        updatedDraft.time = null;
        updatedDraft.lastInvalidationReason = updatedDraft.lastInvalidationReason ?? 'Time format invalid; cleared.';
      }

      const updated = { draft: updatedDraft };
      bookingStorage.saveDraft(updated.draft);
      return updated;
    }),

  invalidateSchedule: (reason) =>
    set((state) => {
      const draft = { ...state.draft };
      draft.date = null;
      draft.time = null;
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
      bookingStorage.cacheBookings(nextBookings);
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
      const restoredDraft: DraftBooking = {
        ...initialDraft,
        ...savedDraft,
        time: savedDraft.time && isValidHHmm(savedDraft.time) ? savedDraft.time : null,
      };
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
        selectedTaskId: booking.selectedTaskId ?? null,
        selectedAddOnIds: booking.selectedAddOnIds ?? [],
        workerId: booking.workerId ?? null,
        entrySource: 'book_again',
        workerLocked: false,
        date: null,
        time: null,
        paymentMethod: null,
      };
      bookingStorage.saveDraft(updatedDraft);
      return { draft: updatedDraft };
    }),
}));