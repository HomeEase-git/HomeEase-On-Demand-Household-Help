import { randomUUID } from 'crypto';
import bcryptjs from 'bcryptjs';
import prisma from '@config/database';
import type { Role } from '@prisma/client';

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