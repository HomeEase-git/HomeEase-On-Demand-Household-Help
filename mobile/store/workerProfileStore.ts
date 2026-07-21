import { create } from "zustand";

export type DigitalIdSettings = {
  enabled: boolean;
  trade: string;
  serviceArea: string;
  licenseNumber: string;
};

export type WorkerProfile = {
  name: string;
  trade: string;
  yearsOfExperience: number;
  masteryLevel: string;
  summary: string;
  skills: string[];
  certifications: string[];
  digitalId?: DigitalIdSettings;
};

export type WorkerProfileState = {
  profile: WorkerProfile | null;
  isSaved: boolean;
  digitalId: DigitalIdSettings | null;
  setProfile: (profile: WorkerProfile) => void;
  setDigitalId: (digitalId: DigitalIdSettings | null) => void;
  clearProfile: () => void;
};

export const useWorkerProfileStore = create<WorkerProfileState>((set) => ({
  profile: null,
  isSaved: false,
  digitalId: null,
  setProfile: (profile: WorkerProfile) =>
    set({ profile, isSaved: true, digitalId: profile.digitalId ?? null }),
  setDigitalId: (digitalId: DigitalIdSettings | null) => set({ digitalId }),
  clearProfile: () => set({ profile: null, isSaved: false, digitalId: null }),
}));