import { create } from "zustand";
import { API_STATUS_MAP, type BookingStatus } from "./bookingStore";
import type { ConditionType, RoomType, TimeSlot } from "../types/booking4step.types";
import { getBookings } from "../services/api";
import { bookingStartTime } from "../utils/bookingTime";

export type WorkerJob = {
  id: string;
  clientName: string;
  clientId: string | null;
  clientPhone: string | null;
  clientAvatar: string | null;
  service: string;
  status: BookingStatus;
  scheduledDate: string;
  estimatedPrice: number;
  finalPrice: number | null;
  rating: number | null;
  // Exact start time "HH:mm" (older bookings: their old slot's start).
  time: string | null;
  isRush: boolean;
  // Set on a follow-up job after this worker's own inspection.
  parentBookingId: string | null;
  // Scheduled follow-up visits still to come ("Follow Up Date").
  upcomingVisits: { id: string; scheduledDate: string; scheduledTime: string }[];
  rooms: RoomType[];
  condition: ConditionType | null;
  location: string | null;
  city: string | null;
  distanceMeters: number | null;
  workerPayoutEstimate: number | null;
  tip: number;
  groupId: string | null;
  groupTotalDays: number | null;
  groupDayIndex: number | null;
};

// Shape returned by GET /bookings (services/api.ts getBookings()) for a worker
export type ApiWorkerBooking = {
  id: string;
  clientName: string;
  clientId: string | null;
  clientPhone: string | null;
  clientAvatar?: string | null;
  service: string;
  status: string;
  scheduledDate: string;
  estimatedPrice: number;
  finalPrice: number | null;
  rating: number | null;
  scheduledTime?: string | null;
  timeSlot?: TimeSlot | null;
  isRush?: boolean;
  parentBookingId?: string | null;
  upcomingVisits?: { id: string; scheduledDate: string; scheduledTime: string }[];
  rooms?: RoomType[];
  condition?: ConditionType | null;
  location?: string | null;
  city?: string | null;
  distanceMeters?: number | null;
  workerPayoutEstimate?: number | null;
  tip?: number | null;
  groupId?: string | null;
  groupTotalDays?: number | null;
  groupDayIndex?: number | null;
};

export function mapApiJob(b: ApiWorkerBooking): WorkerJob {
  return {
    id: b.id,
    clientName: b.clientName,
    clientId: b.clientId ?? null,
    clientPhone: b.clientPhone ?? null,
    clientAvatar: b.clientAvatar ?? null,
    service: b.service,
    status: API_STATUS_MAP[b.status] ?? "Pending",
    scheduledDate: b.scheduledDate,
    estimatedPrice: b.estimatedPrice,
    finalPrice: b.finalPrice ?? null,
    rating: b.rating ?? null,
    time: bookingStartTime(b),
    isRush: b.isRush ?? false,
    parentBookingId: b.parentBookingId ?? null,
    upcomingVisits: b.upcomingVisits ?? [],
    rooms: b.rooms ?? [],
    condition: b.condition ?? null,
    location: b.location ?? null,
    city: b.city ?? null,
    distanceMeters: b.distanceMeters ?? null,
    workerPayoutEstimate: b.workerPayoutEstimate ?? null,
    tip: b.tip ?? 0,
    groupId: b.groupId ?? null,
    groupTotalDays: b.groupTotalDays ?? null,
    groupDayIndex: b.groupDayIndex ?? null,
  };
}

type WorkerState = {
  jobs: WorkerJob[];
  setJobs: (jobs: WorkerJob[]) => void;
  updateJobStatus: (id: string, status: BookingStatus) => void;
  refreshJobs: () => Promise<void>;
};

export const useWorkerStore = create<WorkerState>((set) => ({
  jobs: [],
  setJobs: (jobs) => set({ jobs }),
  updateJobStatus: (id, status) =>
    set((state) => ({
      jobs: state.jobs.map((j) => (j.id === id ? { ...j, status } : j)),
    })),
  // Shared with the socket "notification:new" listener (app/_layout.tsx) so
  // a BOOKING_REQUEST push updates the jobs list even when the Requests
  // screen isn't the focused/polling screen (e.g. worker sitting on Home).
  refreshJobs: async () => {
    try {
      const bookings = await getBookings();
      set({ jobs: (bookings as ApiWorkerBooking[]).map(mapApiJob) });
    } catch (error) {
      console.error("Refresh worker jobs error:", error);
    }
  },
}));
