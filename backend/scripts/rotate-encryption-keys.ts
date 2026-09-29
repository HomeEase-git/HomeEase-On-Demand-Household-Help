// Finishes an encryption-key rotation: re-encrypts every value still under the
// previous key with the current one, and recomputes WorkerProfile.tinHash.
// See docs/SECRETS.md for the full procedure. Idempotent — values already under
// the current key are skipped, so it's safe to re-run.
//
// Covers DATA_ENCRYPTION_KEY: WorkerProfile.payoutAccountNumber, WorkerProfile.tin
// (+ tinHash), Payout.accountNumber, TaxCertificate.workerTin; and
// MFA_ENCRYPTION_KEY: MfaSecret.secretEncrypted.
//
// Usage (from backend/), with the SAME env values the deployed backend now has:
//   DATA_ENCRYPTION_KEY=<new> DATA_ENCRYPTION_KEY_PREVIOUS=<old> \
//     npx tsx scripts/rotate-encryption-keys.ts --dry    # report only
//   ...same...  npx tsx scripts/rotate-encryption-keys.ts  # apply
//   (MFA_ENCRYPTION_KEY / MFA_ENCRYPTION_KEY_PREVIOUS the same way.)
//   add --neon-websocket  to connect through Neon's WebSocket proxy (port 443)
//     when the network blocks raw Postgres connections to Neon; needs
//     `npm i --no-save @prisma/adapter-neon @neondatabase/serverless ws`.
//
// Exits 1 without writing that value if something decrypts with neither key.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { decrypt, encrypt, isUnderPreviousKey } from '../src/utils/encryption';
import { decryptField, encryptField, hashTin, isEncryptedField, isUnderPreviousDataKey } from '../src/utils/fieldEncryption';
import { normalizeTin } from '../src/utils/taxId';

const DRY_RUN = process.argv.includes('--dry');
const NEON_WEBSOCKET = process.argv.includes('--neon-websocket');

const rotatingData = !!process.env.DATA_ENCRYPTION_KEY_PREVIOUS?.trim();
const rotatingMfa = !!process.env.MFA_ENCRYPTION_KEY_PREVIOUS?.trim();

if (!rotatingData && !rotatingMfa) {
  console.error('Neither DATA_ENCRYPTION_KEY_PREVIOUS nor MFA_ENCRYPTION_KEY_PREVIOUS is set — nothing to rotate.');
  process.exit(1);
}
for (const [rotating, name] of [[rotatingData, 'DATA_ENCRYPTION_KEY'], [rotatingMfa, 'MFA_ENCRYPTION_KEY']] as const) {
  if (rotating && !process.env[name]?.trim()) {
    console.error(`${name} (the new key) is not set — refusing to run.`);
    process.exit(1);
  }
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

const unreadable: string[] = [];

/** New ciphertext if `stored` is under the previous data key; undefined if it needs nothing. */
function reencryptField(stored: string | null, label: string): string | undefined {
  if (!stored || !isEncryptedField(stored)) return undefined;
  try {
    return isUnderPreviousDataKey(stored) ? encryptField(decryptField(stored)) : undefined;
  } catch {
    unreadable.push(label);
    return undefined;
  }
}

async function rotateDataKey() {
  let profiles = 0;
  let payouts = 0;
  let certificates = 0;

  const workerProfiles = await prisma.workerProfile.findMany({
    where: { OR: [{ payoutAccountNumber: { not: null } }, { tin: { not: null } }] },
    select: { id: true, payoutAccountNumber: true, tin: true, tinHash: true },
  });
  for (const profile of workerProfiles) {
    const data: { payoutAccountNumber?: string; tin?: string; tinHash?: string } = {};
    const account = reencryptField(profile.payoutAccountNumber, `WorkerProfile ${profile.id} payoutAccountNumber`);
    if (account) data.payoutAccountNumber = account;

    if (profile.tin && isEncryptedField(profile.tin)) {
      const tin = reencryptField(profile.tin, `WorkerProfile ${profile.id} tin`);
      if (tin) data.tin = tin;
      // Rehash whenever the stored hash isn't the current key's — also fixes
      // a hash left stale by an interrupted earlier run.
      try {
        const currentHash = hashTin(normalizeTin(decryptField(profile.tin)));
        if (profile.tinHash !== currentHash) data.tinHash = currentHash;
      } catch {
        // Already recorded as unreadable above.
      }
    }

    if (Object.keys(data).length > 0) {
      profiles++;
      if (!DRY_RUN) await prisma.workerProfile.update({ where: { id: profile.id }, data });
    }
  }

  const payoutRows = await prisma.payout.findMany({
    where: { accountNumber: { startsWith: 'enc:' } },
    select: { id: true, accountNumber: true },
  });
  for (const payout of payoutRows) {
    const accountNumber = reencryptField(payout.accountNumber, `Payout ${payout.id} accountNumber`);
    if (!accountNumber) continue;
    payouts++;
    if (!DRY_RUN) await prisma.payout.update({ where: { id: payout.id }, data: { accountNumber } });
  }

  const certificateRows = await prisma.taxCertificate.findMany({
    where: { workerTin: { startsWith: 'enc:' } },
    select: { id: true, workerTin: true },
  });
  for (const certificate of certificateRows) {
    const workerTin = reencryptField(certificate.workerTin, `TaxCertificate ${certificate.id} workerTin`);
    if (!workerTin) continue;
    certificates++;
    if (!DRY_RUN) await prisma.taxCertificate.update({ where: { id: certificate.id }, data: { workerTin } });
  }

  console.log(`DATA_ENCRYPTION_KEY: worker profiles ${profiles}, payouts ${payouts}, tax certificates ${certificates} ${DRY_RUN ? 'would be' : ''} updated`);
}

async function rotateMfaKey() {
  let secrets = 0;
  const rows = await prisma.mfaSecret.findMany({ select: { id: true, secretEncrypted: true } });
  for (const row of rows) {
    let underPrevious: boolean;
    try {
      underPrevious = isUnderPreviousKey(row.secretEncrypted);
    } catch {
      unreadable.push(`MfaSecret ${row.id}`);
      continue;
    }
    if (!underPrevious) continue;
    secrets++;
    if (!DRY_RUN) {
      await prisma.mfaSecret.update({ where: { id: row.id }, data: { secretEncrypted: encrypt(decrypt(row.secretEncrypted)) } });
    }
  }
  console.log(`MFA_ENCRYPTION_KEY: MFA secrets ${secrets} ${DRY_RUN ? 'would be' : ''} updated`);
}

async function main() {
  console.log(DRY_RUN ? 'DRY RUN — no changes will be written.' : 'Applying changes.');
  if (rotatingData) await rotateDataKey();
  if (rotatingMfa) await rotateMfaKey();

  if (unreadable.length > 0) {
    console.error(`\n${unreadable.length} value(s) decrypt with neither key and were left untouched:`);
    for (const label of unreadable) console.error(`  - ${label}`);
    console.error('Check that the *_PREVIOUS value is the key those rows were written with.');
    process.exitCode = 1;
    return;
  }
  console.log(DRY_RUN ? '\nDry run complete.' : '\nDone. Once the app has run cleanly, remove the *_PREVIOUS variable(s).');
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
