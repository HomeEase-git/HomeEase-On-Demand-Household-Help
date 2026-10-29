// One-off backfill: encrypts payout account numbers written before field
// encryption existed (see src/utils/fieldEncryption.ts). Idempotent — values
// already carrying the `enc:v1:` prefix are skipped, so it's safe to re-run.
//
// Covers WorkerProfile.payoutAccountNumber and Payout.accountNumber.
//
// Usage (from backend/):
//   npx tsx scripts/encrypt-sensitive-fields.ts --dry     # report only, no writes
//   npx tsx scripts/encrypt-sensitive-fields.ts           # apply
//   add --neon-websocket  to connect through Neon's WebSocket proxy (port 443)
//     when the network blocks raw Postgres connections to Neon; needs
//     `npm i --no-save @prisma/adapter-neon @neondatabase/serverless ws`.
//
// DATA_ENCRYPTION_KEY must be set to the SAME value the deployed backend
// uses — values encrypted with a different key can't be read by the app.
// Respects backend/.env DATABASE_URL. Run against dev first.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { encryptField, isEncryptedField } from '../src/utils/fieldEncryption';

const DRY_RUN = process.argv.includes('--dry');
const NEON_WEBSOCKET = process.argv.includes('--neon-websocket');

if (!process.env.DATA_ENCRYPTION_KEY?.trim()) {
  console.error('DATA_ENCRYPTION_KEY is not set — refusing to run (it must match the deployed backend).');
  process.exit(1);
}

const pool = NEON_WEBSOCKET ? null : new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = pool ? new PrismaClient({ adapter: new PrismaPg(pool) }) : makeNeonWebsocketClient();

function makeNeonWebsocketClient(): PrismaClient {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { PrismaNeon } = require('@prisma/adapter-neon');
  const { neonConfig } = require('@neondatabase/serverless');
  neonConfig.webSocketConstructor = require('ws');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
}

async function main() {
  const profiles = await prisma.workerProfile.findMany({
    where: { payoutAccountNumber: { not: null } },
    select: { id: true, payoutAccountNumber: true },
  });
  const plainProfiles = profiles.filter((p) => !isEncryptedField(p.payoutAccountNumber!));
  if (!DRY_RUN) {
    for (const profile of plainProfiles) {
      await prisma.workerProfile.update({
        where: { id: profile.id },
        data: { payoutAccountNumber: encryptField(profile.payoutAccountNumber!) },
      });
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

  const verb = DRY_RUN ? 'Would encrypt' : 'Encrypted';
  console.log(`${verb}: ${plainProfiles.length} worker profile(s), ${plainPayouts.length} payout(s).`);
  if (DRY_RUN) console.log('Dry run — no changes written. Re-run without --dry to apply.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool?.end();
  });
