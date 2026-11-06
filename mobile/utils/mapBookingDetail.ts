import { API_STATUS_MAP, type Booking } from "../store/bookingStore";
import type { ConditionType, RoomType, TimeSlot } from "../types/booking4step.types";

export type InvoiceLine = {
  id: string | null;
  kind: "JOB" | "PACKAGE" | "PREFERENCE" | "PART" | "EXTRA_WORK";
  name: string;
  price: number;
  photoUrls: string[];
};

export type ApiInvoice = {
  status: "NOT_SENT" | "DUE" | "REPORTED" | "PAID" | "CANCELLED";
  sentAt: string | null;
  lines: InvoiceLine[];
  subtotal: number;
  vatAmount: number;
  tip: number;
  total: number;
};

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
  rescheduledAt?: string | null;
  previousScheduledDate?: string | null;
  previousTimeSlot?: TimeSlot | null;
  originalScheduledDate?: string | null;
  rescheduleAcknowledgedAt?: string | null;
  workerNoShowFlaggedAt?: string | null;
  isRush?: boolean;
  rescheduleRequestedAt?: string | null;
  clientNotHereAt?: string | null;
  clientNoShowCancelAt?: string | null;
  clientFaultFeeAmount?: number;
  cancelRequestedAt?: string | null;
  cancelRequestReason?: string | null;
  cancelRequestEscalatedAt?: string | null;
  hasOpenDispute?: boolean;
  rescheduleRequestedBy?: "CLIENT" | "WORKER" | null;
  requestedScheduledDate?: string | null;
  requestedScheduledTime?: string | null;
  requestedTimeSlot?: TimeSlot | null;
  rescheduleRequestRespondedAt?: string | null;
  rescheduleRequestAccepted?: boolean | null;
  rooms?: RoomType[];
  scopeAnswers?: Record<string, string | string[]> | null;
  // How many units, for a per-unit job.
  quantity?: number | null;
  quantityUnit?: string | null;
  scheduledDate: string;
  scheduledTime: string | null;
  estimatedPrice: number;
  finalPrice: number | null;
  vatApplicable?: boolean;
  vatRate?: number | null;
  priceBreakdown?: {
    basePrice: number | null;
    distanceFee: number;
    distanceFeeNote?: string | null;
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
  beforePhotoUrls?: string[];
  progressPhotoUrls?: string[];
  timeline?: { workerArrivedAt?: string | null; workerStartedAt?: string | null; workerCompletedAt?: string | null } | null;
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
  groupId?: string | null;
  group?: { totalDays: number; bookings: { id: string; scheduledDate: string; status: string }[] } | null;
  invoice?: ApiInvoice;
  review: { rating: number; comment: string | null; workerResponse?: string | null } | null;
  parentBooking?: { id: string; scheduledDate: string; service: string } | null;
  followUps?: { id: string; status: string; scheduledDate: string; service: string }[];
  allowsFollowUp?: boolean;
  visits?: { id: string; scheduledDate: string; scheduledTime: string; notes: string | null; status: string }[];
  cancellation?: {
    fault?: "CLIENT" | "WORKER" | null;
    reason?: string | null;
    compensationStatus?: string;
    compensationAmount?: number | null;
    cancelledBy?: string;
  } | null;
  declineReason?: string | null;
  declinedAt?: string | null;
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
