import type { Prisma } from '@prisma/client';
import prisma from '@config/database';

export type WorkerSetupItem = 'PROFILE_PHOTO' | 'PAYOUT_METHOD' | 'ADDRESS' | 'AVAILABILITY' | 'SERVICES';

export const WORKER_SETUP_ITEMS: { key: WorkerSetupItem; label: string }[] = [
  { key: 'PROFILE_PHOTO', label: 'Profile photo' },
  { key: 'PAYOUT_METHOD', label: 'Payout method' },
  { key: 'ADDRESS', label: 'Service address' },
  { key: 'AVAILABILITY', label: 'Availability' },
  { key: 'SERVICES', label: 'Service tasks' },
];

export const WORKER_SETUP_INCOMPLETE_MESSAGE =
  'Finish setting up your profile before accepting requests (profile photo, payout method, address, availability and service tasks).';

export function workerSetupCompleteWhere(): Prisma.WorkerProfileWhereInput {
  return {
    AND: [
      { user: { avatar: { not: null }, status: 'ACTIVE' } },
      { payoutMethod: { not: null }, payoutAccountNumber: { not: null } },
      { address: { not: null }, addressLat: { not: null }, addressLng: { not: null } },
      // At least one working day on the weekly schedule.
      { NOT: { availableDays: { isEmpty: true } } },
      { serviceCategories: { some: { status: 'VERIFIED' } } },
      { taskSelections: { some: { isActive: true, serviceTask: { isActive: true } } } },
    ],
  };
}

export type WorkerSetupStatus = {
  complete: boolean;
  items: { key: WorkerSetupItem; label: string; done: boolean }[];
  missing: WorkerSetupItem[];
};

export async function getWorkerSetupStatus(userId: string): Promise<WorkerSetupStatus | null> {
  const profile = await prisma.workerProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      payoutMethod: true,
      payoutAccountNumber: true,
      address: true,
      addressLat: true,
      addressLng: true,
      availableDays: true,
      user: { select: { avatar: true } },
      serviceCategories: { where: { status: 'VERIFIED' }, select: { serviceTypeId: true } },
    },
  });
  if (!profile) return null;

  const verifiedTypeIds = profile.serviceCategories.map((c) => c.serviceTypeId);
  const selectedTask =
    verifiedTypeIds.length > 0 &&
    !!(await prisma.workerTaskSelection.findFirst({
      where: {
        workerProfileId: profile.id,
        isActive: true,
        serviceTask: { isActive: true, serviceTypeId: { in: verifiedTypeIds } },
      },
      select: { id: true },
    }));

  const done: Record<WorkerSetupItem, boolean> = {
    PROFILE_PHOTO: !!profile.user.avatar,
    PAYOUT_METHOD: !!profile.payoutMethod && !!profile.payoutAccountNumber,
    ADDRESS: !!profile.address && profile.addressLat != null && profile.addressLng != null,
    AVAILABILITY: profile.availableDays.length > 0,
    SERVICES: selectedTask,
  };

  const items = WORKER_SETUP_ITEMS.map((i) => ({ ...i, done: done[i.key] }));
  const missing = items.filter((i) => !i.done).map((i) => i.key);
  return { complete: missing.length === 0, items, missing };
}
