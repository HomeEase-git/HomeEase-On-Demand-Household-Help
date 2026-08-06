import { randomUUID } from 'crypto';
import bcryptjs from 'bcryptjs';
import prisma from '@config/database';
import type { BookingStatus, Role, TimeSlot } from '@prisma/client';

// All test-created accounts share this marker in the local part of the email
// so a stray failed run is easy to spot and hand-clean in the DB if needed.
export const TEST_EMAIL_MARKER = 'e2etest';

export function testEmail(label: string): string {
  return `${TEST_EMAIL_MARKER}.${label}.${randomUUID().slice(0, 8)}@homeease.invalid`;
}

interface CreateTestUserOptions {
  role: Role;
  password?: string;
  fullName?: string;
  status?: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
}

export async function createTestUser(label: string, options: CreateTestUserOptions) {
  const plainPassword = options.password ?? 'TestPass123!';
  const hashedPassword = await bcryptjs.hash(plainPassword, 10);

  const user = await prisma.user.create({
    data: {
      email: testEmail(label),
      password: hashedPassword,
      fullName: options.fullName ?? `Test ${options.role} ${label}`,
      role: options.role,
      isVerified: true,
      status: options.status ?? 'ACTIVE',
      ...(options.role === 'WORKER' ? { workerProfile: { create: {} } } : {}),
      ...(options.role === 'CLIENT' ? { clientProfile: { create: {} } } : {}),
    },
  });

  return { user, plainPassword };
}

// User has cascading deletes configured for its owned relations (profiles,
// verification requests, etc.), so removing the user is enough cleanup.
export async function deleteTestUser(userId: string) {
  await prisma.user.delete({ where: { id: userId } }).catch(() => {
    // Already deleted by the test itself (e.g. via a status-changing flow) — fine.
  });
}

interface CreateTestBookingOptions {
  clientId: string;
  workerId?: string | null;
  status?: BookingStatus;
  timeSlot?: TimeSlot;
  scheduledDate?: Date;
  estimatedPrice?: number;
  clientLat?: number;
  clientLng?: number;
}

// Seeds a Booking directly (bypassing POST /api/bookings, whose auto-match/
// pricing-rule/worker-capacity setup is unrelated overhead for tests that
// exercise a specific mid-lifecycle transition, not booking creation).
export async function createTestBooking(options: CreateTestBookingOptions) {
  return prisma.booking.create({
    data: {
      clientId: options.clientId,
      workerId: options.workerId ?? null,
      serviceType: 'Cleaning',
      description: 'e2e test booking',
      location: '123 Test St, Test City',
      city: 'Manila',
      scheduledDate: options.scheduledDate ?? new Date(Date.now() + 24 * 60 * 60 * 1000 + Math.random() * 1e10),
      timeSlot: options.timeSlot ?? 'MORNING',
      estimatedPrice: options.estimatedPrice ?? 1000,
      status: options.status ?? 'PENDING',
      clientLat: options.clientLat,
      clientLng: options.clientLng,
    },
  });
}

// Booking cascades from its client/worker User via onDelete: Cascade, so
// deleteTestUser cleans these up too — this is for tests that want to tear
// a booking down independently mid-test.
export async function deleteTestBooking(bookingId: string) {
  await prisma.booking.delete({ where: { id: bookingId } }).catch(() => {
    // Already removed (e.g. cascaded from a user delete) — fine.
  });
}