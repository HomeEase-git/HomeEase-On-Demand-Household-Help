import { API_STATUS_MAP, type Booking } from "../store/bookingStore";
import type { ConditionType, RoomType, TimeSlot } from "../types/booking4step.types";

// The client booking detail API response and its mapping to the app's
// Booking shape. Moved out of app/(client)/booking/[bookingId]/index.tsx.

export type ApiBookingDetail = {
  id: string;
  worker: { id: string; fullName: string; phone?: string | null; avatar?: string | null; verified?: boolean } | null;
  service: string;
  category?: string;
  status: string;
  description?: string | null;
  location: string;
  city?: string | null;
  clientLat?: number | null;
  clientLng?: number | null;
  timeSlot?: TimeSlot | null;
  condition?: ConditionType | null;
  // Reschedule-on-conflict (see backend bookingController.extendBooking) —
  // rescheduleAcknowledgedAt null means this is still an open episode
  // awaiting the client's explicit response.
  rescheduledAt?: string | null;
  previousScheduledDate?: string | null;
  previousTimeSlot?: TimeSlot | null;
  // The true original date, surviving multiple reschedule hops — differs
  // from previousScheduledDate only after a second+ hop (see backend
  // Booking.originalScheduledDate).
  originalScheduledDate?: string | null;
  rescheduleAcknowledgedAt?: string | null;
  // Set once the worker never checks in past the grace period (see backend
  // bookingWorker.flagWorkerNoShows) — lets the client cancel penalty-free
  // even though the booking is past PENDING.
  workerNoShowFlaggedAt?: string | null;
  // Reschedule-on-REQUEST (see backend requestReschedule) — distinct from
  // the fields above (this booking's spillover moving a DIFFERENT booking).
  // rescheduleRequestRespondedAt null means still awaiting the worker.
  rescheduleRequestedAt?: string | null;
  requestedScheduledDate?: string | null;
  requestedTimeSlot?: TimeSlot | null;
  rescheduleRequestRespondedAt?: string | null;
  rescheduleRequestAccepted?: boolean | null;
  rooms?: RoomType[];
  scopeAnswers?: Record<string, string | string[]> | null;
  scheduledDate: string;
  scheduledTime: string | null;
  estimatedPrice: number;
  finalPrice: number | null;
  vatApplicable?: boolean;
  vatRate?: number | null;
  priceBreakdown?: {
    basePrice: number | null;
    distanceFee: number;
    tierFee: number;
    addOns: { name: string; price: number }[];
    subtotal: number;
    vatApplicable: boolean;
    vatRate: number | null;
    vatAmount: number;
    tip: number;
    total: number;
  };
  completionPhotoUrl?: string | null;
  // Settled at booking time — used to auto-process payment after completion
  // is confirmed, without asking the client to pick a method again.
  paymentMethodType?: string | null;
  paymentAccountIdentifier?: string | null;
  payment: {
    methodType: string;
    accountIdentifier: string | null;
    status: string;
    totalAmount: number;
    subtotal?: number;
    tip?: number;
  } | null;
  addOns?: { id: string; name: string; price: number; clientApprovedAt: string | null; clientRejectedAt: string | null }[];
  // Multi-day upfront booking (see backend createMultiDayBooking) — null for
  // an ordinary single-day booking. Sibling list is date-ordered.
  groupId?: string | null;
  group?: { totalDays: number; bookings: { id: string; scheduledDate: string; status: string }[] } | null;
  quote: {
    laborCost: number;
    materialsCost: number;
    notes: string | null;
    quotedAt: string | null;
  } | null;
  review: { rating: number; comment: string | null } | null;
};

export function mapApiBookingDetail(d: ApiBookingDetail): Booking {
  return {
    id: d.id,
    service: d.service,
    category: d.category ?? undefined,
    worker: d.worker?.fullName ?? "Unassigned",
    workerId: d.worker?.id,
    workerPhone: d.worker?.phone ?? undefined,
    workerAvatar: d.worker?.avatar ?? undefined,
    workerVerified: d.worker?.verified ?? undefined,
    date: d.scheduledDate,
    time: d.scheduledTime ?? undefined,
    address: d.location,
    status: API_STATUS_MAP[d.status] ?? "Pending",
    amount: d.finalPrice ?? d.estimatedPrice,
    priceBreakdown: d.priceBreakdown ?? null,
    completionPhotoUrl: d.completionPhotoUrl ?? undefined,
    payment: d.payment
      ? {
          methodType: d.payment.methodType,
          accountIdentifier: d.payment.accountIdentifier ?? undefined,
          status: d.payment.status,
          totalAmount: d.payment.totalAmount,
        }
      : d.paymentMethodType
        ? {
            methodType: d.paymentMethodType,
            accountIdentifier: d.paymentAccountIdentifier ?? undefined,
          }
        : undefined,
    quote: d.quote
      ? {
          laborCost: d.quote.laborCost,
          materialsCost: d.quote.materialsCost,
          totalAmount: d.finalPrice ?? 0,
          notes: d.quote.notes ?? "",
          submittedAt: d.quote.quotedAt ?? d.scheduledDate,
        }
      : undefined,
    rating: d.review?.rating,
    reviewText: d.review?.comment ?? undefined,
    rescheduledAt: d.rescheduledAt,
    previousScheduledDate: d.previousScheduledDate,
    previousTimeSlot: d.previousTimeSlot,
    originalScheduledDate: d.originalScheduledDate,
    rescheduleAcknowledgedAt: d.rescheduleAcknowledgedAt,
    workerNoShowFlaggedAt: d.workerNoShowFlaggedAt,
    groupId: d.groupId ?? undefined,
    groupTotalDays: d.group?.totalDays ?? undefined,
    groupDayIndex: d.group ? d.group.bookings.findIndex((b) => b.id === d.id) + 1 : undefined,
  };
}
