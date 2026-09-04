// Minimal, idempotent seed for _e2e_test_run.js — just the two fixed
// pieces of data it depends on but never creates itself: the E2E
// test-admin account it logs in as, and a "Cleaning" ServiceType to book
// against. Deliberately lighter than seed.ts/seed-full.ts/seed-complete.ts
// (which seed a full demo dataset) — this is only for standing up a fresh
// DB (e.g. a CI runner's Postgres container) enough to run that one script.
import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Matches _e2e_test_run.js's E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD defaults.
  const email = process.env.E2E_ADMIN_EMAIL ?? 'e2e.admin@homeease.invalid';
  const password = process.env.E2E_ADMIN_PASSWORD ?? 'E2eAdminPass123!';

  const existingAdmin = await prisma.user.findUnique({ where: { email } });
  if (existingAdmin) {
    console.log(`E2E admin already exists: ${existingAdmin.id}`);
  } else {
    const hashedPassword = await bcrypt.hash(password, 10);
    const admin = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        fullName: 'E2E Test Admin',
        role: Role.ADMIN,
        isVerified: true,
      },
    });
    console.log('Created E2E admin:', admin.id);
  }

  const existingServiceType = await prisma.serviceType.findFirst({ where: { name: 'Cleaning' } });
  if (existingServiceType) {
    console.log(`"Cleaning" service type already exists: ${existingServiceType.id}`);
  } else {
    const serviceType = await prisma.serviceType.create({
      data: {
        name: 'Cleaning',
        description: 'Home and post-construction cleaning services',
        basePrice: 500,
      },
    });
    console.log('Created "Cleaning" service type:', serviceType.id);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
