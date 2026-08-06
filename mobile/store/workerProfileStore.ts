import { create } from "zustand";

export type WorkerProfile = {
  name: string;
  trade: string;
  yearsOfExperience: number;
  masteryLevel: string;
  summary: string;
  skills: string[];
  certifications: string[];
};

export type WorkerProfileState = {
  profile: WorkerProfile | null;
  isSaved: boolean;
  setProfile: (profile: WorkerProfile) => void;
  clearProfile: () => void;
};

export const useWorkerProfileStore = create<WorkerProfileState>((set) => ({
  profile: null,
  isSaved: false,
  setProfile: (profile: WorkerProfile) => set({ profile, isSaved: true }),
  clearProfile: () => set({ profile: null, isSaved: false }),
}));