// Restore drill (docs/DATA-RESILIENCE.md): proves the production database can
// really be restored to an earlier point in time, and times it.
//   1. Creates a Neon branch of the default branch as it was N minutes ago
//      (Neon's point-in-time restore). The branch is set to expire after 6
//      hours, so it's cleaned up even if this script dies.
//   2. Checks the restored copy: migration history, that it really is the
//      earlier point in time, row counts, ledger balance, constraints and
//      indexes, and (when the keys are set) that encrypted fields decrypt.
//   3. Deletes the branch.
// Prints counts and pass/fail only, never row contents.
//
// Usage (from backend/):
//   NEON_API_KEY=... npx tsx scripts/restore-drill.ts --project-id <id> [--minutes-ago 60] [--role <owner>] [--keep]
//   npx tsx scripts/restore-drill.ts --verify-only <connection string> [--as-of <ISO time>]
//     checks a database that's already restored (e.g. before switching the
//     app to it in an incident) without creating anything
//   add --neon-websocket  to connect through Neon's WebSocket proxy (port 443)
//     when the network blocks raw Postgres connections to Neon; needs
//     `npm i --no-save @prisma/adapter-neon @neondatabase/serverless ws`.
// Set DATA_ENCRYPTION_KEY / MFA_ENCRYPTION_KEY (production values) to also
// check encrypted fields; without them those checks are skipped.
//
// Runs every quarter in GitHub Actions (.github/workflows/restore-drill.yml).
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { decrypt } from '../src/utils/encryption';
import { decryptField } from '../src/utils/fieldEncryption';

const NEONCTL = 'neonctl@6.3.0'; // pinned: this tool handles production credentials
const DATABASE_NAME = 'neondb';
// Neon's default owner login. Named explicitly: once scripts/db-roles.ts has
// run, the project has several.
const DEFAULT_ROLE = 'neondb_owner';
const BRANCH_LIFETIME_MS = 6 * 60 * 60 * 1000;
// Clock difference allowed between Neon's restore point and row timestamps.
const CLOCK_SKEW_MS = 2 * 60 * 1000;
const ENCRYPTED_SAMPLE = 25;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

type Status = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
interface Check {
  label: string;
  status: Status;
  detail: string;
}

const checks: Check[] = [];
const timings: [string, number][] = [];
const counts: [string, number][] = [];
const add = (label: string, status: Status, detail: string) => checks.push({ label, status, detail });

function neon(neonArgs: string[]): string {
  if (!process.env.NEON_API_KEY) throw new Error('NEON_API_KEY is not set.');
  // The key reaches neonctl through the environment, not argv.
  return execFileSync('npx', ['-y', NEONCTL, ...neonArgs], {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'inherit'],
    // Windows needs a shell to find npx.cmd; every argument here is a fixed
    // string, a generated branch name, a timestamp or the project id.
    shell: process.platform === 'win32',
  });
}

function connect(connectionString: string): { prisma: PrismaClient; close: () => Promise<void> } {
  if (flag('--neon-websocket')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { PrismaNeon } = require('@prisma/adapter-neon');
    const { neonConfig } = require('@neondatabase/serverless');
    neonConfig.webSocketConstructor = require('ws');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
    return { prisma, close: () => prisma.$disconnect() };
  }
  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  return { prisma, close: async () => { await prisma.$disconnect(); await pool.end(); } };
}

/** A new branch's compute starts on first connection; allow it a minute. */
async function waitForDatabase(prisma: PrismaClient): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function verify(prisma: PrismaClient, asOf: Date | undefined): Promise<void> {
  const tables = (await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename::text AS tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`).map((t) => t.tablename);
  const has = (table: string) => tables.includes(table);

  // Migration history: nothing half-applied, and in step with this checkout.
  if (!has('_prisma_migrations')) {
    add('Migration history', 'FAIL', 'No _prisma_migrations table: this is not a HomeEase database.');
    return;
  }
  const migrations = await prisma.$queryRaw<{ name: string; failed: boolean }[]>`
    SELECT migration_name AS name, (finished_at IS NULL AND rolled_back_at IS NULL) AS failed
    FROM _prisma_migrations WHERE rolled_back_at IS NULL`;
  const migrationsDir = path.resolve(__dirname, '..', 'prisma', 'migrations');
  const inRepo = readdirSync(migrationsDir).filter((d) => statSync(path.join(migrationsDir, d)).isDirectory());
  const applied = new Set(migrations.filter((m) => !m.failed).map((m) => m.name));
  const failed = migrations.filter((m) => m.failed).map((m) => m.name);
  const notApplied = inRepo.filter((m) => !applied.has(m));
  const unknown = [...applied].filter((m) => !inRepo.includes(m));
  if (failed.length > 0) {
    add('Migration history', 'FAIL', `Unfinished migration(s): ${failed.join(', ')}.`);
  } else if (unknown.length > 0) {
    add('Migration history', 'WARN', `${applied.size} applied, including ${unknown.length} this checkout doesn't have: ${unknown.join(', ')}.`);
  } else {
    // Not applied: merged after the restore point, or not deployed yet.
    const note = notApplied.length ? ` Not in this copy yet: ${notApplied.join(', ')}.` : '';
    add('Migration history', 'PASS', `${applied.size} applied, none failed.${note}`);
  }

  // Point in time: no row in the copy may have been created or updated after
  // the restore point. Every table's createdAt and updatedAt columns are
  // checked (updatedAt catches changes to existing rows). A change that
  // touches neither column is invisible here; for that we rely on Neon.
  // Epochs are computed in SQL: the columns are UTC timestamps without a
  // time zone, which the driver would read as local time.
  const stampColumns = await prisma.$queryRaw<{ tableName: string; columnName: string }[]>`
    SELECT table_name::text AS "tableName", column_name::text AS "columnName" FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name IN ('createdAt', 'updatedAt') AND data_type LIKE 'timestamp%'`;
  const newest = stampColumns.length
    ? await prisma.$queryRawUnsafe<{ source: string; epoch: number }[]>(
        `SELECT source, epoch FROM (${stampColumns
          .map(({ tableName, columnName }) => `SELECT '${`${tableName}.${columnName}`.replace(/'/g, "''")}' AS source,
            EXTRACT(EPOCH FROM max(${quoteIdent(columnName)}))::float8 AS epoch FROM ${quoteIdent(tableName)}`)
          .join(' UNION ALL ')}) x WHERE epoch IS NOT NULL ORDER BY epoch DESC LIMIT 1`,
      )
    : [];
  const scope = `${stampColumns.length} createdAt/updatedAt columns`;
  if (!asOf) {
    add('Point in time', 'SKIP', 'No restore point given (--as-of).');
  } else if (newest.length === 0) {
    add('Point in time', 'WARN', `No timestamped rows to compare (${scope}).`);
  } else if (newest[0].epoch * 1000 > asOf.getTime() + CLOCK_SKEW_MS) {
    add('Point in time', 'FAIL', `${newest[0].source} has a value (${new Date(newest[0].epoch * 1000).toISOString()}) after the restore point: this is not the requested point in time.`);
  } else {
    const gapMin = Math.round((asOf.getTime() - newest[0].epoch * 1000) / 60_000);
    add('Point in time', 'PASS', `Newest change ${new Date(newest[0].epoch * 1000).toISOString()} (${newest[0].source}), ${gapMin} min before the restore point; ${scope} checked.`);
  }

  // Row counts (exact). Data present at all is the minimum bar.
  for (const table of tables.filter((t) => t !== '_prisma_migrations')) {
    const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${quoteIdent(table)}`);
    counts.push([table, Number(row.n)]);
  }
  const users = counts.find(([t]) => t === 'User')?.[1] ?? 0;
  const total = counts.reduce((sum, [, n]) => sum + n, 0);
  add('Data present', users > 0 ? 'PASS' : 'FAIL', `${users} users, ${total} rows in ${counts.length} tables.`);

  // Constraints and indexes all valid.
  const [invalid] = await prisma.$queryRaw<[{ constraints: bigint; indexes: bigint }]>`
    SELECT (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
              WHERE n.nspname = 'public' AND NOT c.convalidated) AS constraints,
           (SELECT count(*) FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
              WHERE n.nspname = 'public' AND NOT i.indisvalid) AS indexes`;
  const bad = Number(invalid.constraints) + Number(invalid.indexes);
  add('Constraints and indexes', bad === 0 ? 'PASS' : 'FAIL',
    bad === 0 ? 'All valid.' : `${invalid.constraints} constraint(s) and ${invalid.indexes} index(es) not valid.`);

  // Double-entry ledger: every transaction still balances.
  if (has('LedgerLine')) {
    const [row] = await prisma.$queryRaw<[{ n: bigint }]>`
      SELECT count(*) AS n FROM (
        SELECT l."transactionId" FROM "LedgerLine" l GROUP BY l."transactionId" HAVING SUM(l."amountCentavos") <> 0
      ) x`;
    const n = Number(row.n);
    add('Ledger balances', n === 0 ? 'PASS' : 'FAIL', n === 0 ? 'Every transaction balances.' : `${n} transaction(s) don't balance.`);
  }

  // Encrypted fields: a restore is only useful if the keys still open it.
  if (process.env.DATA_ENCRYPTION_KEY?.trim()) {
    const values = await prisma.$queryRawUnsafe<{ v: string }[]>(`
      SELECT v FROM (
        SELECT tin AS v FROM "WorkerProfile" UNION ALL
        SELECT "payoutAccountNumber" FROM "WorkerProfile" UNION ALL
        SELECT "accountNumber" FROM "Payout" UNION ALL
        SELECT "workerTin" FROM "TaxCertificate"
      ) x WHERE v LIKE 'enc:v1:%' LIMIT ${ENCRYPTED_SAMPLE}`);
    const failures = values.filter(({ v }) => {
      try {
        decryptField(v);
        return false;
      } catch {
        return true;
      }
    }).length;
    add('Encrypted fields (DATA_ENCRYPTION_KEY)', values.length === 0 ? 'SKIP' : failures === 0 ? 'PASS' : 'FAIL',
      values.length === 0 ? 'No encrypted values in this copy.' : `${values.length - failures} of ${values.length} sampled values decrypt.`);
  } else {
    add('Encrypted fields (DATA_ENCRYPTION_KEY)', 'SKIP', 'Key not set for this run.');
  }
  if (process.env.MFA_ENCRYPTION_KEY?.trim() && has('MfaSecret')) {
    const secrets = await prisma.$queryRawUnsafe<{ v: string }[]>(
      `SELECT "secretEncrypted" AS v FROM "MfaSecret" LIMIT ${ENCRYPTED_SAMPLE}`);
    const failures = secrets.filter(({ v }) => {
      try {
        decrypt(v);
        return false;
      } catch {
        return true;
      }
    }).length;
    add('MFA secrets (MFA_ENCRYPTION_KEY)', secrets.length === 0 ? 'SKIP' : failures === 0 ? 'PASS' : 'FAIL',
      secrets.length === 0 ? 'No MFA secrets in this copy.' : `${secrets.length - failures} of ${secrets.length} decrypt.`);
  } else {
    add('MFA secrets (MFA_ENCRYPTION_KEY)', 'SKIP', 'Key not set for this run.');
  }
}

function report(title: string): string {
  const icon: Record<Status, string> = { PASS: '✅', WARN: '⚠️', FAIL: '❌', SKIP: '➖' };
  const lines = [
    `## ${title}`,
    '',
    '| Check | Result | Detail |',
    '|---|---|---|',
    ...checks.map((c) => `| ${c.label} | ${icon[c.status]} ${c.status} | ${c.detail} |`),
  ];
  if (timings.length) {
    lines.push('', '| Step | Seconds |', '|---|---|', ...timings.map(([step, ms]) => `| ${step} | ${(ms / 1000).toFixed(1)} |`));
  }
  if (counts.length) {
    lines.push('', '<details><summary>Rows per table</summary>', '', '| Table | Rows |', '|---|---|',
      ...counts.map(([t, n]) => `| ${t} | ${n} |`), '', '</details>');
  }
  return lines.join('\n') + '\n';
}

async function runVerifyOnly(connectionString: string) {
  const asOfArg = option('--as-of');
  const asOf = asOfArg ? new Date(asOfArg) : undefined;
  if (asOf && Number.isNaN(asOf.getTime())) throw new Error('--as-of must be an ISO date/time.');
  const db = connect(connectionString);
  try {
    await waitForDatabase(db.prisma);
    await verify(db.prisma, asOf);
  } finally {
    await db.close();
  }
  return 'Restored database check';
}

async function runDrill() {
  const projectId = option('--project-id') ?? process.env.NEON_PROJECT_ID;
  if (!projectId) throw new Error('Pass --project-id (or set NEON_PROJECT_ID).');
  const minutesAgo = Number(option('--minutes-ago') ?? 60);
  if (!Number.isFinite(minutesAgo) || minutesAgo < 1) throw new Error('--minutes-ago must be a positive number.');

  const started = Date.now();
  const asOf = new Date(started - minutesAgo * 60_000);
  const branch = `restore-drill-${new Date(started).toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
  const expiresAt = new Date(started + BRANCH_LIFETIME_MS).toISOString();

  console.log(`Restoring the default branch as of ${asOf.toISOString()} into branch ${branch}...`);
  neon(['branches', 'create', '--project-id', projectId, '--name', branch,
    '--parent', asOf.toISOString(), '--expires-at', expiresAt, '--output', 'json']);
  timings.push(['Branch created (point-in-time restore)', Date.now() - started]);

  try {
    const connectionString = neon(['connection-string', branch, '--project-id', projectId,
      '--database-name', DATABASE_NAME, '--role-name', option('--role') ?? DEFAULT_ROLE]).trim();
    // Holds the password: only ever passed to the driver, never printed.
    const db = connect(connectionString);
    try {
      await waitForDatabase(db.prisma);
      timings.push(['Restored database answering queries', Date.now() - started]);
      await verify(db.prisma, asOf);
      timings.push(['Checks finished', Date.now() - started]);
    } finally {
      await db.close();
    }
  } finally {
    if (flag('--keep')) {
      console.log(`Kept branch ${branch}; it expires at ${expiresAt}.`);
    } else {
      try {
        neon(['branches', 'delete', branch, '--project-id', projectId]);
      } catch {
        console.error(`Could not delete branch ${branch}. It expires on its own at ${expiresAt}; or delete it in the Neon console.`);
      }
    }
  }
  return `Restore drill: default branch as of ${asOf.toISOString()}`;
}

async function main() {
  const verifyOnly = option('--verify-only');
  const title = verifyOnly ? await runVerifyOnly(verifyOnly) : await runDrill();

  const markdown = report(title);
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  if (checks.some((c) => c.status === 'FAIL')) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  if (checks.length) console.log(report('Restore drill (incomplete)'));
  process.exitCode = 1;
});
