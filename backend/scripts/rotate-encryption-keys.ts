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
// Safety:
// - Everything is planned first; if any value decrypts with neither key, the
//   script lists them and writes nothing.
// - Each write only applies if the row still holds the value that was read,
//   so a worker saving new details mid-run is never overwritten (that row is
//   reported; re-run to pick it up).
// - Two workers with the same TIN can't both exist under one key (unique
//   index). If one slipped in under different keys while old and new
//   instances overlapped during the switch, the rehash hits the index and
//   both profiles are reported for manual resolution.
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
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

type Table = 'workerProfile' | 'payout' | 'taxCertificate' | 'mfaSecret';

interface PlannedUpdate {
  table: Table;
  id: string;
  label: string;
  /** Column values the row must still hold for the write to apply. */
  expect: Record<string, string | null>;
  data: Record<string, string>;
}

const unreadable: string[] = [];
const planned: PlannedUpdate[] = [];

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

async function planDataKey() {
  const workerProfiles = await prisma.workerProfile.findMany({
    where: { OR: [{ payoutAccountNumber: { not: null } }, { tin: { not: null } }] },
    select: { id: true, payoutAccountNumber: true, tin: true, tinHash: true },
  });
  for (const profile of workerProfiles) {
    const data: Record<string, string> = {};
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
      planned.push({
        table: 'workerProfile',
        id: profile.id,
        label: `WorkerProfile ${profile.id}`,
        expect: { payoutAccountNumber: profile.payoutAccountNumber, tin: profile.tin },
        data,
      });
    }
  }

  const payouts = await prisma.payout.findMany({
    where: { accountNumber: { startsWith: 'enc:' } },
    select: { id: true, accountNumber: true },
  });
  for (const payout of payouts) {
    const accountNumber = reencryptField(payout.accountNumber, `Payout ${payout.id} accountNumber`);
    if (accountNumber) {
      planned.push({ table: 'payout', id: payout.id, label: `Payout ${payout.id}`, expect: { accountNumber: payout.accountNumber }, data: { accountNumber } });
    }
  }

  const certificates = await prisma.taxCertificate.findMany({
    where: { workerTin: { startsWith: 'enc:' } },
    select: { id: true, workerTin: true },
  });
  for (const certificate of certificates) {
    const workerTin = reencryptField(certificate.workerTin, `TaxCertificate ${certificate.id} workerTin`);
    if (workerTin) {
      planned.push({
        table: 'taxCertificate',
        id: certificate.id,
        label: `TaxCertificate ${certificate.id}`,
        expect: { workerTin: certificate.workerTin },
        data: { workerTin },
      });
    }
  }
}

async function planMfaKey() {
  const rows = await prisma.mfaSecret.findMany({ select: { id: true, secretEncrypted: true } });
  for (const row of rows) {
    let underPrevious: boolean;
    try {
      underPrevious = isUnderPreviousKey(row.secretEncrypted);
    } catch {
      unreadable.push(`MfaSecret ${row.id}`);
      continue;
    }
    if (underPrevious) {
      planned.push({
        table: 'mfaSecret',
        id: row.id,
        label: `MfaSecret ${row.id}`,
        expect: { secretEncrypted: row.secretEncrypted },
        data: { secretEncrypted: encrypt(decrypt(row.secretEncrypted)) },
      });
    }
  }
}

/** Writes one planned update if the row is unchanged; returns what happened. */
async function apply(update: PlannedUpdate): Promise<'updated' | 'changed' | 'duplicate'> {
  const where = { id: update.id, ...update.expect };
  try {
    // Dynamic model access: every Table has id + the string columns used here.
    const delegate = (prisma as unknown as Record<Table, { updateMany: (args: object) => Promise<{ count: number }> }>)[update.table];
    const { count } = await delegate.updateMany({ where, data: update.data });
    return count === 1 ? 'updated' : 'changed';
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'duplicate';
    throw error;
  }
}

async function main() {
  console.log(DRY_RUN ? 'DRY RUN — no changes will be written.' : 'Applying changes.');
  if (rotatingData) await planDataKey();
  if (rotatingMfa) await planMfaKey();

  const count = (table: Table) => planned.filter((u) => u.table === table).length;
  const verb = DRY_RUN ? 'to update' : 'planned';
  if (rotatingData) {
    console.log(`DATA_ENCRYPTION_KEY: worker profiles ${count('workerProfile')}, payouts ${count('payout')}, tax certificates ${count('taxCertificate')} ${verb}`);
  }
  if (rotatingMfa) console.log(`MFA_ENCRYPTION_KEY: MFA secrets ${count('mfaSecret')} ${verb}`);

  if (unreadable.length > 0) {
    console.error(`\n${unreadable.length} value(s) decrypt with neither key — nothing was written:`);
    for (const label of unreadable) console.error(`  - ${label}`);
    console.error('Check that the *_PREVIOUS value is the key those rows were written with.');
    process.exitCode = 1;
    return;
  }
  if (DRY_RUN) {
    console.log('\nDry run complete.');
    return;
  }

  const changedMidRun: string[] = [];
  const duplicates: string[] = [];
  for (const update of planned) {
    const outcome = await apply(update);
    if (outcome === 'changed') changedMidRun.push(update.label);
    if (outcome === 'duplicate') duplicates.push(update.label);
  }
  console.log(`\nUpdated ${planned.length - changedMidRun.length - duplicates.length} of ${planned.length}.`);

  if (changedMidRun.length > 0) {
    console.warn(`${changedMidRun.length} row(s) were edited while this ran and were left alone — re-run to finish them:`);
    for (const label of changedMidRun) console.warn(`  - ${label}`);
    process.exitCode = 1;
  }
  if (duplicates.length > 0) {
    console.error(`${duplicates.length} worker profile(s) share a TIN with another worker (saved under different keys during the switch) — resolve by hand, then re-run:`);
    for (const label of duplicates) console.error(`  - ${label}`);
    process.exitCode = 1;
  }
  if (!process.exitCode) console.log('Done. Once the app has run cleanly, remove the *_PREVIOUS variable(s).');
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
