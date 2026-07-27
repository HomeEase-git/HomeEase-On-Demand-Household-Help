import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL, // pooled connection for runtime queries
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.env.ADMIN_EMAIL ?? 'admin@homeease.dev';
  const plainPassword = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
  const fullName = process.env.ADMIN_NAME ?? 'HomeEase Admin';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`User with email ${email} already exists (id: ${existing.id}). Aborting.`);
    return;
  }

  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  const admin = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      fullName,
      role: Role.ADMIN,
      isVerified: true,
    },
  });

  console.log('Admin account created:', { id: admin.id, email: admin.email, role: admin.role });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });