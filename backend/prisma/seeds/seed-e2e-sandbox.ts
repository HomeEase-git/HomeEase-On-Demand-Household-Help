import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

function assertSandboxDatabase(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the e2e sandbox seed with NODE_ENV=production.');
  }
  const host = new URL(process.env.DATABASE_URL ?? '').hostname;
  const isLocal = ['localhost', '127.0.0.1', '::1', 'postgres', 'db'].includes(host);
  if (!isLocal && process.env.E2E_SEED_ALLOW_REMOTE !== 'true') {
    throw new Error(`Refusing to seed an e2e admin into non-local database host "${host}". Set E2E_SEED_ALLOW_REMOTE=true for a throwaway remote DB.`);
  }
}
assertSandboxDatabase();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
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
