// Finishes an encryption-key rotation: re-encrypts every value still under the
// previous key with the current one.
// See docs/SECRETS.md for the full procedure. Idempotent — values already under
// the current key are skipped, so it's safe to re-run.
//
// Covers DATA_ENCRYPTION_KEY: WorkerProfile.payoutAccountNumber,
// Payout.accountNumber; and
// MFA_ENCRYPTION_KEY: MfaSecret.secretEncrypted.
//
// Usage (from backend/), with the SAME env values the deployed backend now has:
//   DATA_ENCRYPTION_KEY=<new> DATA_ENCRYPTION_KEY_PREVIOUS=<old> \
//     npx tsx scripts/rotate-encryption-keys.ts --dry    # report only
//   ...same...  npx tsx scripts/rotate-encryption-keys.ts  # apply
//   (MFA_ENCRYPTION_KEY / MFA_ENCRYPTION_KEY_PREVIOUS the same way.)
//   add --user <id>  (repeatable) to touch only those users' rows, e.g. to
//     re-run one account, or to run against a shared dev database.
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
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { decrypt, encrypt, isUnderPreviousKey } from '../src/utils/encryption';
import { decryptField, encryptField, isEncryptedField, isUnderPreviousDataKey } from '../src/utils/fieldEncryption';

const DRY_RUN = process.argv.includes('--dry');
const NEON_WEBSOCKET = process.argv.includes('--neon-websocket');
// --user <id>, repeatable: only these users' rows (all rows when absent).
const USER_IDS: string[] = [];
process.argv.forEach((arg, i) => {
  if (arg !== '--user') return;
  const id = process.argv[i + 1];
  if (!id || id.startsWith('--')) {
    console.error('--user needs a user id after it — refusing to run.');
    process.exit(1);
  }
  USER_IDS.push(id);
});
const onlyUsers = <K extends string>(key: K) => (USER_IDS.length > 0 ? ({ [key]: { in: USER_IDS } } as Record<K, { in: string[] }>) : {});

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

type Table = 'workerProfile' | 'payout' | 'mfaSecret';

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
    where: { payoutAccountNumber: { startsWith: 'enc:' }, ...onlyUsers('userId') },
    select: { id: true, payoutAccountNumber: true },
  });
  for (const profile of workerProfiles) {
    const payoutAccountNumber = reencryptField(profile.payoutAccountNumber, `WorkerProfile ${profile.id} payoutAccountNumber`);
    if (payoutAccountNumber) {
      planned.push({
        table: 'workerProfile',
        id: profile.id,
        label: `WorkerProfile ${profile.id}`,
        expect: { payoutAccountNumber: profile.payoutAccountNumber },
        data: { payoutAccountNumber },
      });
    }
  }

  const payouts = await prisma.payout.findMany({
    where: { accountNumber: { startsWith: 'enc:' }, ...onlyUsers('workerId') },
    select: { id: true, accountNumber: true },
  });
  for (const payout of payouts) {
    const accountNumber = reencryptField(payout.accountNumber, `Payout ${payout.id} accountNumber`);
    if (accountNumber) {
      planned.push({ table: 'payout', id: payout.id, label: `Payout ${payout.id}`, expect: { accountNumber: payout.accountNumber }, data: { accountNumber } });
    }
  }
}

async function planMfaKey() {
  const rows = await prisma.mfaSecret.findMany({ where: onlyUsers('userId'), select: { id: true, secretEncrypted: true } });
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
async function apply(update: PlannedUpdate): Promise<'updated' | 'changed'> {
  const where = { id: update.id, ...update.expect };
  // Dynamic model access: every Table has id + the string columns used here.
  const delegate = (prisma as unknown as Record<Table, { updateMany: (args: object) => Promise<{ count: number }> }>)[update.table];
  const { count } = await delegate.updateMany({ where, data: update.data });
  return count === 1 ? 'updated' : 'changed';
}

async function main() {
  console.log(DRY_RUN ? 'DRY RUN — no changes will be written.' : 'Applying changes.');
  if (rotatingData) await planDataKey();
  if (rotatingMfa) await planMfaKey();

  const count = (table: Table) => planned.filter((u) => u.table === table).length;
  const verb = DRY_RUN ? 'to update' : 'planned';
  if (rotatingData) {
    console.log(`DATA_ENCRYPTION_KEY: worker profiles ${count('workerProfile')}, payouts ${count('payout')} ${verb}`);
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
  for (const update of planned) {
    if ((await apply(update)) === 'changed') changedMidRun.push(update.label);
  }
  console.log(`\nUpdated ${planned.length - changedMidRun.length} of ${planned.length}.`);

  if (changedMidRun.length > 0) {
    console.warn(`${changedMidRun.length} row(s) were edited while this ran and were left alone — re-run to finish them:`);
    for (const label of changedMidRun) console.warn(`  - ${label}`);
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
