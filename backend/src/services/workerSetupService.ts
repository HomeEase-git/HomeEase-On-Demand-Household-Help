import type { Prisma } from '@prisma/client';
import prisma from '@config/database';

/**
 * A worker must finish setting up their account before they can be found,
 * booked or accept a request. Every item here is something the worker does
 * themselves (KYC approval is a separate, admin-side gate checked alongside
 * this everywhere it matters).
 *
 * workerSetupCompleteWhere and getWorkerSetupStatus must agree item for item:
 * the first filters search/auto-match at the DB level, the second drives the
 * worker's own checklist and the booking/accept guards.
 */
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

function todayStart(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Prisma filter: only workers whose account setup is complete. */
export function workerSetupCompleteWhere(now = new Date()): Prisma.WorkerProfileWhereInput {
  return {
    AND: [
      { user: { avatar: { not: null } } },
      { payoutMethod: { not: null }, payoutAccountNumber: { not: null } },
      { address: { not: null }, addressLat: { not: null }, addressLng: { not: null } },
      {
        OR: [
          { availabilityTemplate: { some: {} } },
          { availability: { some: { date: { gte: todayStart(now) }, isBlocked: false } } },
        ],
      },
      // Prisma can't tie the selection to the worker's own category row, so
      // these are two checks. selectTask only accepts tasks under a VERIFIED
      // category, which keeps them in step.
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

/** The worker's own setup checklist. Null when the user has no worker profile. */
export async function getWorkerSetupStatus(userId: string, now = new Date()): Promise<WorkerSetupStatus | null> {
  const profile = await prisma.workerProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      payoutMethod: true,
      payoutAccountNumber: true,
      address: true,
      addressLat: true,
      addressLng: true,
      user: { select: { avatar: true } },
      serviceCategories: { where: { status: 'VERIFIED' }, select: { serviceTypeId: true } },
      _count: { select: { availabilityTemplate: true } },
    },
  });
  if (!profile) return null;

  const verifiedTypeIds = profile.serviceCategories.map((c) => c.serviceTypeId);
  const [openSlot, selectedTask] = await Promise.all([
    profile._count.availabilityTemplate > 0
      ? Promise.resolve(true)
      : prisma.workerAvailability
          .findFirst({
            where: { workerProfileId: profile.id, date: { gte: todayStart(now) }, isBlocked: false },
            select: { id: true },
          })
          .then(Boolean),
    verifiedTypeIds.length
      ? prisma.workerTaskSelection
          .findFirst({
            where: {
              workerProfileId: profile.id,
              isActive: true,
              serviceTask: { isActive: true, serviceTypeId: { in: verifiedTypeIds } },
            },
            select: { id: true },
          })
          .then(Boolean)
      : Promise.resolve(false),
  ]);

  const done: Record<WorkerSetupItem, boolean> = {
    PROFILE_PHOTO: !!profile.user.avatar,
    PAYOUT_METHOD: !!profile.payoutMethod && !!profile.payoutAccountNumber,
    ADDRESS: !!profile.address && profile.addressLat != null && profile.addressLng != null,
    AVAILABILITY: openSlot,
    SERVICES: selectedTask,
  };

  const items = WORKER_SETUP_ITEMS.map((i) => ({ ...i, done: done[i.key] }));
  const missing = items.filter((i) => !i.done).map((i) => i.key);
  return { complete: missing.length === 0, items, missing };
}
