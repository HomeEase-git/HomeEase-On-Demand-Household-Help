import { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { supabase } from '@config/supabase';
import { parseStorageUrl } from '@utils/storageUrls';
import { revokeUserSessions } from '@utils/tokenRevocation';
import { revokeAllRefreshTokens } from '@utils/otpService';

// What "delete my account" does (Data Privacy Act §§11, 16(e)), and what the
// app tells the user it does — keep the two in sync with the delete-account
// screens and the Privacy Policy's retention section.
//
// ERASED: name, email, phone, avatar, push token, notification settings,
// saved addresses, profile addresses and coordinates, live location, bio,
// resume (file + AI parse), KYC files (IDs, selfie, clearances),
// certification files, VAT document, chat images the user sent, payout
// account, TIN, MFA secrets, login tokens and notifications.
//
// KEPT (legal/accounting obligations and the other party's records):
// bookings, payments, payouts, tax certificates (BIR requires the payee
// name/TIN as issued), disputes, reviews (shown as "Deleted user"), chat
// text, contract acceptance records and audit logs. The KYC/certification
// rows themselves stay (document type + review outcome, no file) as the
// record of what was verified.

export const DELETED_USER_NAME = 'Deleted user';

const OPEN_BOOKING_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'IN_PROGRESS',
  'QUOTE_SUBMITTED',
  'QUOTE_APPROVED',
  'DISPUTED',
  'PENDING_COMPLETION',
  'AWAITING_PAYMENT',
] as const;

/** Reasons the account can't be deleted yet, as user-facing sentences. */
export async function findDeletionBlockers(userId: string): Promise<string[]> {
  const [openBookings, clientProfile, workerProfile, unpaidPayouts] = await Promise.all([
    prisma.booking.count({
      where: {
        OR: [{ clientId: userId }, { workerId: userId }],
        status: { in: [...OPEN_BOOKING_STATUSES] },
      },
    }),
    prisma.clientProfile.findUnique({ where: { userId }, select: { outstandingBalance: true } }),
    prisma.workerProfile.findUnique({ where: { userId }, select: { commissionOwed: true } }),
    prisma.payout.count({ where: { workerId: userId, status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } } }),
  ]);

  const blockers: string[] = [];
  if (openBookings > 0) {
    blockers.push(`You have ${openBookings} booking(s) still in progress. Complete or cancel them first.`);
  }
  if ((clientProfile?.outstandingBalance ?? 0) > 0) {
    blockers.push('You have an unpaid balance. Please settle it first.');
  }
  if ((workerProfile?.commissionOwed ?? 0) > 0) {
    blockers.push('You have unpaid platform commission from cash jobs. Please settle it first.');
  }
  if (unpaidPayouts > 0) {
    blockers.push('Some of your earnings have not been paid out yet. Wait for them to arrive, or contact support.');
  }
  return blockers;
}

async function collectStoredFiles(userId: string): Promise<string[]> {
  const [user, workerProfile, kycDocuments, sentImages] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { avatar: true } }),
    prisma.workerProfile.findUnique({
      where: { userId },
      select: { resumeUrl: true, vatDocumentUrl: true, certifications: { select: { documentUrl: true } } },
    }),
    prisma.kycDocument.findMany({ where: { verificationRequest: { userId } }, select: { fileUrl: true } }),
    prisma.message.findMany({ where: { senderId: userId, imageUrl: { not: null } }, select: { imageUrl: true } }),
  ]);

  return [
    user?.avatar,
    workerProfile?.resumeUrl,
    workerProfile?.vatDocumentUrl,
    ...(workerProfile?.certifications.map((c) => c.documentUrl) ?? []),
    ...kycDocuments.map((d) => d.fileUrl),
    ...sentImages.map((m) => m.imageUrl),
  ].filter((url): url is string => !!url);
}

async function removeStoredFiles(urls: string[]): Promise<void> {
  const byBucket = new Map<string, string[]>();
  for (const url of urls) {
    const ref = parseStorageUrl(url);
    if (!ref) continue;
    byBucket.set(ref.bucket, [...(byBucket.get(ref.bucket) ?? []), ref.path]);
  }

  await Promise.all(
    [...byBucket.entries()].map(async ([bucket, paths]) => {
      const { error } = await supabase.storage.from(bucket).remove(paths);
      if (error) {
        // DB side is already erased; log so orphaned files can be purged by hand.
        console.error(`Account deletion: failed to remove ${paths.length} file(s) from "${bucket}":`, error);
      }
    })
  );
}

/**
 * Erases a user's personal data (see the header comment for exactly what).
 * Callers must check findDeletionBlockers first.
 */
export async function eraseAccount(userId: string, sessionTtlSeconds: number): Promise<void> {
  const files = await collectStoredFiles(userId);
  const workerProfile = await prisma.workerProfile.findUnique({ where: { userId }, select: { id: true } });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        email: `deleted+${userId}@deleted.homeease.invalid`,
        phone: null,
        fullName: DELETED_USER_NAME,
        // Not a valid bcrypt hash, so no password can ever match it.
        password: '!deleted',
        avatar: null,
        pushToken: null,
        notificationPreferences: Prisma.DbNull,
        mfaEnabled: false,
        isDeleted: true,
        deletedAt: new Date(),
        status: 'DELETED',
      },
    }),
    prisma.userAddress.deleteMany({ where: { userId } }),
    prisma.clientProfile.updateMany({
      where: { userId },
      data: { address: null, city: null, state: null, zipCode: null },
    }),
    prisma.workerProfile.updateMany({
      where: { userId },
      data: {
        bio: null,
        address: null,
        city: null,
        state: null,
        zipCode: null,
        addressLat: null,
        addressLng: null,
        currentLat: null,
        currentLng: null,
        lastLocationUpdate: null,
        resumeUrl: null,
        payoutAccountName: null,
        payoutAccountNumber: null,
        tin: null,
        tinHash: null,
        licenseNumber: null,
        digitalIdTrade: null,
        digitalIdServiceArea: null,
        vatDocumentUrl: null,
      },
    }),
    ...(workerProfile
      ? [
          prisma.resumeParseResult.deleteMany({ where: { workerProfileId: workerProfile.id } }),
          prisma.certification.updateMany({ where: { workerProfileId: workerProfile.id }, data: { documentUrl: '' } }),
        ]
      : []),
    prisma.kycDocument.updateMany({
      where: { verificationRequest: { userId } },
      data: { fileUrl: '', fileName: null, originalName: null },
    }),
    prisma.message.updateMany({ where: { senderId: userId, imageUrl: { not: null } }, data: { imageUrl: null } }),
    prisma.notification.deleteMany({ where: { userId } }),
    prisma.authToken.deleteMany({ where: { userId } }),
    prisma.mfaSecret.deleteMany({ where: { userId } }),
    prisma.mfaBackupCode.deleteMany({ where: { userId } }),
  ]);

  await removeStoredFiles(files);
  await revokeUserSessions(userId, sessionTtlSeconds);
  await revokeAllRefreshTokens(userId);
}
