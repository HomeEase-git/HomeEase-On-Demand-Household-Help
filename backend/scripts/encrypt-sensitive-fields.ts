// One-off backfill: encrypts payout account numbers and TINs written before
// field encryption existed (see src/utils/fieldEncryption.ts), and fills
// WorkerProfile.tinHash for existing TINs. Idempotent — values already
// carrying the `enc:v1:` prefix are skipped, so it's safe to re-run.
//
// Covers WorkerProfile.payoutAccountNumber, WorkerProfile.tin (+ tinHash),
// Payout.accountNumber and TaxCertificate.workerTin.
//
// Usage (from backend/):
//   npx tsx scripts/encrypt-sensitive-fields.ts --dry     # report only, no writes
//   npx tsx scripts/encrypt-sensitive-fields.ts           # apply
//
// DATA_ENCRYPTION_KEY must be set to the SAME value the deployed backend
// uses — values encrypted with a different key can't be read by the app.
// Respects backend/.env DATABASE_URL. Run against dev first.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { encryptField, hashTin, isEncryptedField } from '../src/utils/fieldEncryption';
import { normalizeTin } from '../src/utils/taxId';

const DRY_RUN = process.argv.includes('--dry');

if (!process.env.DATA_ENCRYPTION_KEY?.trim()) {
  console.error('DATA_ENCRYPTION_KEY is not set — refusing to run (it must match the deployed backend).');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const profiles = await prisma.workerProfile.findMany({
    where: { OR: [{ payoutAccountNumber: { not: null } }, { tin: { not: null } }] },
    select: { id: true, payoutAccountNumber: true, tin: true, tinHash: true },
  });

  let profilesUpdated = 0;
  for (const profile of profiles) {
    const data: { payoutAccountNumber?: string; tin?: string; tinHash?: string } = {};

    if (profile.payoutAccountNumber && !isEncryptedField(profile.payoutAccountNumber)) {
      data.payoutAccountNumber = encryptField(profile.payoutAccountNumber);
    }
    if (profile.tin && !isEncryptedField(profile.tin)) {
      const normalized = normalizeTin(profile.tin);
      data.tin = encryptField(normalized);
      data.tinHash = hashTin(normalized);
    }

    if (Object.keys(data).length === 0) continue;
    profilesUpdated++;
    if (!DRY_RUN) {
      await prisma.workerProfile.update({ where: { id: profile.id }, data });
    }
  }

  const payouts = await prisma.payout.findMany({ select: { id: true, accountNumber: true } });
  const plainPayouts = payouts.filter((p) => !isEncryptedField(p.accountNumber));
  if (!DRY_RUN) {
    for (const payout of plainPayouts) {
      await prisma.payout.update({
        where: { id: payout.id },
        data: { accountNumber: encryptField(payout.accountNumber) },
      });
    }
  }

  const certificates = await prisma.taxCertificate.findMany({ select: { id: true, workerTin: true } });
  const plainCertificates = certificates.filter((c) => !isEncryptedField(c.workerTin));
  if (!DRY_RUN) {
    for (const certificate of plainCertificates) {
      await prisma.taxCertificate.update({
        where: { id: certificate.id },
        data: { workerTin: encryptField(certificate.workerTin) },
      });
    }
  }

  const verb = DRY_RUN ? 'Would encrypt' : 'Encrypted';
  console.log(`${verb}: ${profilesUpdated} worker profile(s), ${plainPayouts.length} payout(s), ${plainCertificates.length} tax certificate(s).`);
  if (DRY_RUN) console.log('Dry run — no changes written. Re-run without --dry to apply.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
