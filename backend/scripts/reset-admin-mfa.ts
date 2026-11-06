import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const email = arg('--email')?.trim().toLowerCase();
const reason = arg('--reason')?.trim();
const CONFIRM = process.argv.includes('--confirm');
const NEON_WEBSOCKET = process.argv.includes('--neon-websocket');

function makeClient(): PrismaClient {
  if (!NEON_WEBSOCKET) {
    return new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) });
  }
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { PrismaNeon } = require('@prisma/adapter-neon');
  const { neonConfig } = require('@neondatabase/serverless');
  neonConfig.webSocketConstructor = require('ws');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
}

async function main() {
  if (!email || !reason) {
    console.error('Usage: npx tsx scripts/reset-admin-mfa.ts --email <admin email> --reason "<why>" [--confirm]');
    process.exit(1);
  }
  const prisma = makeClient();
  try {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true, email: true, fullName: true, role: true, mfaEnabled: true },
    });
    if (!user) throw new Error(`No user with email ${email}`);
    if (user.role !== 'ADMIN') throw new Error(`${user.email} is not an admin (${user.role}) — this script only resets admins`);

    const [secrets, codes] = await Promise.all([
      prisma.mfaSecret.count({ where: { userId: user.id } }),
      prisma.mfaBackupCode.count({ where: { userId: user.id } }),
    ]);
    console.log(`Admin: ${user.fullName} <${user.email}> — MFA ${user.mfaEnabled ? 'on' : 'off'}, ${secrets} secret(s), ${codes} backup code(s)`);
    console.log(`Database: ${new URL(process.env.DATABASE_URL ?? 'postgres://unknown').host}`);

    if (!CONFIRM) {
      console.log('Dry run — nothing changed. Add --confirm to reset.');
      return;
    }

    await prisma.$transaction([
      prisma.mfaBackupCode.deleteMany({ where: { userId: user.id } }),
      prisma.mfaSecret.deleteMany({ where: { userId: user.id } }),
      prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false } }),
      prisma.authToken.deleteMany({ where: { userId: user.id, type: 'REFRESH' } }),
      prisma.auditLog.create({
        data: {
          actorId: null,
          actorName: 'server script',
          action: 'ADMIN_MFA_RESET',
          category: 'ADMIN_ACTION',
          level: 'WARN',
          message: `Two-step sign-in reset for admin ${user.email} from a server script: ${reason}`,
          metadata: { userId: user.id },
        },
      }),
    ]);
    console.log('Reset. They will be asked to set up two-step sign-in again when they next sign in.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
