import { create } from "zustand";
import { API_STATUS_MAP, type BookingStatus } from "./bookingStore";
import type { ConditionType, RoomType, TimeSlot } from "../types/booking4step.types";

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
  timeSlot: TimeSlot | null;
  rooms: RoomType[];
  condition: ConditionType | null;
  location: string | null;
  city: string | null;
  distanceMeters: number | null;
  workerPayoutEstimate: number | null;
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
  timeSlot?: TimeSlot | null;
  rooms?: RoomType[];
  condition?: ConditionType | null;
  location?: string | null;
  city?: string | null;
  distanceMeters?: number | null;
  workerPayoutEstimate?: number | null;
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
    timeSlot: b.timeSlot ?? null,
    rooms: b.rooms ?? [],
    condition: b.condition ?? null,
    location: b.location ?? null,
    city: b.city ?? null,
    distanceMeters: b.distanceMeters ?? null,
    workerPayoutEstimate: b.workerPayoutEstimate ?? null,
  };
}

type WorkerState = {
  jobs: WorkerJob[];
  setJobs: (jobs: WorkerJob[]) => void;
  updateJobStatus: (id: string, status: BookingStatus) => void;
};

export const useWorkerStore = create<WorkerState>((set) => ({
  jobs: [],
  setJobs: (jobs) => set({ jobs }),
  updateJobStatus: (id, status) =>
    set((state) => ({
      jobs: state.jobs.map((j) => (j.id === id ? { ...j, status } : j)),
    })),
}));
