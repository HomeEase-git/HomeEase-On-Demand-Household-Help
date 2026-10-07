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
  // Reschedule-on-conflict (from the retired "Continue Tomorrow") —
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
  // Set when the worker never checked in (backend
  // bookingWorker.cancelWorkerNoShows cancels the booking at the same time).
  workerNoShowFlaggedAt?: string | null;
  isRush?: boolean;
  // Reschedule-on-REQUEST (see backend requestReschedule) — either side
  // asks (rescheduleRequestedBy), the other answers. Null
  // rescheduleRequestRespondedAt means still waiting.
  rescheduleRequestedAt?: string | null;
  rescheduleRequestedBy?: "CLIENT" | "WORKER" | null;
  requestedScheduledDate?: string | null;
  requestedScheduledTime?: string | null;
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
    rushFee?: number;
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
    status?: string | null;
    receiptUrls?: string[];
    proofOfUseUrls?: string[];
    rejectionReason?: string | null;
    revision?: number;
  } | null;
  review: { rating: number; comment: string | null } | null;
  // Follow-up jobs: this booking's inspection (parent), and follow-up jobs
  // requested after it. allowsFollowUp = this is an inspection/diagnosis job.
  parentBooking?: { id: string; scheduledDate: string; service: string } | null;
  followUps?: { id: string; status: string; scheduledDate: string; service: string }[];
  allowsFollowUp?: boolean;
  // "Follow Up Date" visits the worker scheduled for this job.
  visits?: { id: string; scheduledDate: string; scheduledTime: string; notes: string | null; status: string }[];
  cancellation?: {
    fault?: "CLIENT" | "WORKER" | null;
    reason?: string | null;
    compensationStatus?: string;
    compensationAmount?: number | null;
  } | null;
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
          totalAmount: d.finalPrice ?? d.quote.laborCost + d.quote.materialsCost,
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
    isRush: d.isRush ?? false,
    groupId: d.groupId ?? undefined,
    groupTotalDays: d.group?.totalDays ?? undefined,
    groupDayIndex: d.group ? d.group.bookings.findIndex((b) => b.id === d.id) + 1 : undefined,
  };
}
