import { randomUUID } from 'crypto';
import bcryptjs from 'bcryptjs';
import prisma from '@config/database';
import { ownerDb } from './ownerDb';
import type { BookingStatus, Prisma, Role } from '@prisma/client';

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

async function deleteMoneyRecords(bookingWhere: Prisma.BookingWhereInput) {
  const payment = { booking: bookingWhere };
  await ownerDb.payout.deleteMany({ where: { payment } });
  await ownerDb.refundRequest.deleteMany({ where: { payment } });
  await ownerDb.payment.deleteMany({ where: payment });
}

export async function deleteTestUser(userId: string) {
  await deleteMoneyRecords({ OR: [{ clientId: userId }, { workerId: userId }] });
  await ownerDb.booking.deleteMany({ where: { OR: [{ clientId: userId }, { workerId: userId }] } });
  await ownerDb.debtLedgerEntry.deleteMany({ where: { workerProfile: { userId } } });
  await prisma.user.delete({ where: { id: userId } }).catch(() => {
  });
}

interface CreateTestBookingOptions {
  clientId: string;
  workerId?: string | null;
  status?: BookingStatus;
  scheduledTime?: string;
  scheduledDate?: Date;
  estimatedPrice?: number;
  workerArrivedAt?: Date | null;
  clientLat?: number;
  clientLng?: number;
}

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
      scheduledTime: options.scheduledTime ?? '09:00',
      estimatedPrice: options.estimatedPrice ?? 1000,
      status: options.status ?? 'PENDING',
      workerArrivedAt: options.workerArrivedAt ?? null,
      clientLat: options.clientLat,
      clientLng: options.clientLng,
    },
  });
}

export async function deleteTestBooking(bookingId: string) {
  await deleteMoneyRecords({ id: bookingId });
  await prisma.booking.delete({ where: { id: bookingId } }).catch(() => {
  });
}
export async function completeWorkerSetup(
  workerUserId: string,
  options: { serviceTypeId?: string; lat?: number; lng?: number } = {}
): Promise<{ createdServiceTypeId: string | null; serviceTaskId: string }> {
  const createdServiceType = options.serviceTypeId
    ? null
    : await prisma.serviceType.create({ data: { name: `e2e setup ${randomUUID().slice(0, 8)}`, basePrice: 500 } });
  const serviceTypeId = options.serviceTypeId ?? createdServiceType!.id;

  await prisma.user.update({ where: { id: workerUserId }, data: { avatar: 'https://example.invalid/avatar.png' } });
  const profile = await prisma.workerProfile.update({
    where: { userId: workerUserId },
    data: {
      payoutMethod: 'GCASH',
      payoutAccountName: 'Test Worker',
      payoutAccountNumber: '09171234567',
      address: '123 Test St',
      city: 'Manila',
      addressLat: options.lat ?? 14.5995,
      addressLng: options.lng ?? 120.9842,
      // Every day, so tests can book any date.
      availableDays: [0, 1, 2, 3, 4, 5, 6],
    },
  });
  await prisma.workerServiceCategory.upsert({
    where: { workerProfileId_serviceTypeId: { workerProfileId: profile.id, serviceTypeId } },
    create: { workerProfileId: profile.id, serviceTypeId, status: 'VERIFIED', verifiedAt: new Date() },
    update: { status: 'VERIFIED' },
  });
  const task = await prisma.serviceTask.create({
    data: { serviceTypeId, name: `e2e setup task ${randomUUID().slice(0, 8)}`, basePrice: 500 },
  });
  await prisma.workerTaskSelection.create({ data: { workerProfileId: profile.id, serviceTaskId: task.id } });

  return { createdServiceTypeId: createdServiceType?.id ?? null, serviceTaskId: task.id };
}
