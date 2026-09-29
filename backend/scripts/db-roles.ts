// Sets up the least-privilege database logins (docs/DATA-RESILIENCE.md,
// "Database roles"):
//   homeease_app       the server's DATABASE_URL. Reads and writes rows; no
//                      schema changes; audit log and ledger are insert-only;
//                      can't touch the migration history.
//   homeease_readonly  SELECT only, read-only sessions: reports, exports,
//                      one-off investigations.
// Migrations keep using the owner login (DIRECT_URL).
//
// Run AFTER `prisma migrate deploy`, connected as the owner. Idempotent:
// re-running re-applies every grant and never changes an existing password
// unless asked. Every table needs an explicit decision: it goes in either
// APPEND_ONLY or READ_WRITE below, and the report fails (so CI fails) for a
// table in neither. A table a migration adds still gets read/write rights
// automatically (default privileges), so production keeps working if this
// script isn't re-run straight after a deploy; re-run it after a migration
// that adds an APPEND_ONLY table.
//
// Usage (from backend/), with DIRECT_URL = the owner connection:
//   APP_DB_PASSWORD=... READONLY_DB_PASSWORD=... npx tsx scripts/db-roles.ts
//                                        # create missing roles, apply grants, report
//   npx tsx scripts/db-roles.ts --check  # report only, change nothing
//   APP_DB_PASSWORD=<new> npx tsx scripts/db-roles.ts --rotate homeease_app
//                                        # change that role's password
//   add --neon-websocket  to connect through Neon's WebSocket proxy (port 443)
//     when the network blocks raw Postgres connections to Neon; needs
//     `npm i --no-save @prisma/adapter-neon @neondatabase/serverless ws`.
// Passwords come from you, never from the script: generate each one in the
// password manager (or `openssl rand -hex 24`) and pass it in the variable.
// The script never prints or stores a password; it prints the connection
// strings with a placeholder where the password goes. A role that already
// exists keeps its password unless its variable is set.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const CHECK_ONLY = process.argv.includes('--check');
const NEON_WEBSOCKET = process.argv.includes('--neon-websocket');
const rotateIndex = process.argv.indexOf('--rotate');
const ROTATE = rotateIndex >= 0 ? process.argv[rotateIndex + 1] : undefined;

const APP_ROLE = 'homeease_app';
const READONLY_ROLE = 'homeease_readonly';
const ROLES = { [APP_ROLE]: 'APP_DB_PASSWORD', [READONLY_ROLE]: 'READONLY_DB_PASSWORD' } as const;
type Role = keyof typeof ROLES;

// The app only ever inserts into these (no UPDATE/DELETE anywhere in src/).
// Keeping it that way at the database means a bug or an injection can't
// rewrite who did what, what was paid, what a worker owed or how a price was
// worked out. Old sign-in audit entries are removed through
// purge_expired_login_audit() instead. (Cascading deletes from a parent row
// still work: Postgres runs those with the table owner's rights.)
const APPEND_ONLY = ['AuditLog', 'LedgerTransaction', 'LedgerLine', 'DebtLedgerEntry', 'PricingLog'];
// Everything else the app reads and writes. A new table goes here or above.
const READ_WRITE = [
  'AppSettings', 'ArrivalVerification', 'AuthToken', 'Booking', 'BookingAddOn', 'BookingGroup', 'BookingVisit',
  'Cancellation', 'Certification', 'ClientProfile', 'ContractAcceptance', 'DeclinedWorker', 'Dispute', 'KycDocument',
  'LedgerReconciliation', 'LedgerState', 'Message', 'MfaBackupCode', 'MfaSecret', 'Notification', 'Payment', 'Payout',
  'PricingRule', 'PromoBanner', 'RefundRequest', 'ResumeParseResult', 'Review', 'SavedPaymentMethod',
  'ServiceScopeField', 'ServiceScopeFieldOption', 'ServiceScopeFieldTask', 'ServiceTask', 'ServiceType',
  'TaxCertificate', 'TaxRemittance', 'User', 'UserAddress', 'VatCollectionSummary', 'VerificationRequest',
  'WorkerAvailability', 'WorkerAvailabilityTemplate', 'WorkerDateOverride', 'WorkerPackage', 'WorkerProfile',
  'WorkerScopeFieldCapability', 'WorkerServiceCategory', 'WorkerTaskPrice', 'WorkerTaskSelection', 'WorkerTaskTierPrice',
];
const MIGRATIONS_TABLE = '_prisma_migrations';

// Postgres ends a statement, or a transaction left open, after this long.
// The app's own interactive transactions time out at 15s (config/database.ts).
const APP_TIMEOUT = '60s';

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Set DIRECT_URL (or DATABASE_URL) to the owner connection string.');
  process.exit(1);
}
if (ROTATE !== undefined && !(ROTATE in ROLES)) {
  console.error(`--rotate takes ${Object.keys(ROLES).join(' or ')}.`);
  process.exit(1);
}

const pool = NEON_WEBSOCKET ? null : new Pool({ connectionString });
const prisma = pool ? new PrismaClient({ adapter: new PrismaPg(pool) }) : makeNeonWebsocketClient();

function makeNeonWebsocketClient(): PrismaClient {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { PrismaNeon } = require('@prisma/adapter-neon');
  const { neonConfig } = require('@neondatabase/serverless');
  neonConfig.webSocketConstructor = require('ws');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

function passwordFor(role: Role): string {
  const password = process.env[ROLES[role]];
  if (!password) {
    throw new Error(`Set ${ROLES[role]} to the password for ${role} (generate one: openssl rand -hex 24).`);
  }
  // Goes into a SQL string literal below.
  if (!/^[A-Za-z0-9_.~-]{16,}$/.test(password)) {
    throw new Error(`${ROLES[role]} must be at least 16 characters of letters, digits and _.~-`);
  }
  return password;
}

const LOGIN_PLACEHOLDER = 'PASSWORD';

/** The connection string for `role`, password left as a placeholder, on the owner's host and database. */
function connectionStringFor(role: Role, pooled: boolean): string {
  const url = new URL(connectionString!);
  url.username = role;
  url.password = LOGIN_PLACEHOLDER;
  // Neon: the pooled endpoint is the same host with "-pooler" after the endpoint id.
  if (pooled && url.hostname.endsWith('.neon.tech') && !url.hostname.split('.')[0].endsWith('-pooler')) {
    const [endpoint, ...rest] = url.hostname.split('.');
    url.hostname = [`${endpoint}-pooler`, ...rest].join('.');
  }
  return url.toString();
}

async function roleExists(role: Role): Promise<boolean> {
  const rows = await prisma.$queryRaw<unknown[]>`SELECT 1 FROM pg_roles WHERE rolname = ${role}`;
  return rows.length > 0;
}

/** Returns the roles whose password was set. */
async function setUp(): Promise<Role[]> {
  const rolesWithNewLogin: Role[] = [];
  const [{ owner, database }] = await prisma.$queryRaw<[{ owner: string; database: string }]>`
    SELECT current_user::text AS owner, current_database()::text AS database`;

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename::text AS tablename FROM pg_tables WHERE schemaname = 'public'`;
  if (!tables.some((t) => t.tablename === 'AuditLog')) {
    throw new Error('No application tables here. Run `npx prisma migrate deploy` first.');
  }

  // Check every password needed before changing anything.
  const plan = new Map<Role, { exists: boolean; password: string | null }>();
  for (const role of Object.keys(ROLES) as Role[]) {
    const exists = await roleExists(role);
    const setPassword = !exists || ROTATE === role || !!process.env[ROLES[role]];
    plan.set(role, { exists, password: setPassword ? passwordFor(role) : null });
  }

  for (const [role, { exists, password }] of plan) {
    const setPassword = password !== null;
    if (!exists) {
      await prisma.$executeRawUnsafe(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    } else if (setPassword) {
      await prisma.$executeRawUnsafe(`ALTER ROLE ${role} PASSWORD '${password}'`);
    }
    if (setPassword) rolesWithNewLogin.push(role);
    await prisma.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${quoteIdent(database)} TO ${role}`);
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
  }

  const appendOnly = APPEND_ONLY.map(quoteIdent).join(', ');
  const statements = [
    // App: rows only.
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
    `REVOKE UPDATE, DELETE, TRUNCATE ON ${appendOnly} FROM ${APP_ROLE}`,
    `REVOKE ALL ON ${quoteIdent(MIGRATIONS_TABLE)} FROM ${APP_ROLE}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`,
    `GRANT EXECUTE ON FUNCTION purge_expired_login_audit() TO ${APP_ROLE}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(owner)} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(owner)} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}`,
    `ALTER ROLE ${APP_ROLE} SET statement_timeout = '${APP_TIMEOUT}'`,
    `ALTER ROLE ${APP_ROLE} SET idle_in_transaction_session_timeout = '${APP_TIMEOUT}'`,
    // Read-only.
    `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${READONLY_ROLE}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(owner)} IN SCHEMA public GRANT SELECT ON TABLES TO ${READONLY_ROLE}`,
    `ALTER ROLE ${READONLY_ROLE} SET default_transaction_read_only = on`,
  ];
  for (const sql of statements) await prisma.$executeRawUnsafe(sql);
  return rolesWithNewLogin;
}

interface Check {
  label: string;
  ok: boolean;
}

async function report(): Promise<Check[]> {
  const checks: Check[] = [];
  for (const role of Object.keys(ROLES) as Role[]) {
    const [info] = await prisma.$queryRaw<
      [{ login: boolean; superuser: boolean; createrole: boolean; createdb: boolean; privileged: boolean } | undefined]
    >`
      SELECT r.rolcanlogin AS login, r.rolsuper AS superuser, r.rolcreaterole AS createrole, r.rolcreatedb AS createdb,
        EXISTS (
          SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
          WHERE m.member = r.oid AND g.rolname IN ('neon_superuser', 'pg_write_all_data', 'pg_read_all_data')
        ) AS privileged
      FROM pg_roles r WHERE r.rolname = ${role}`;
    if (!info) {
      checks.push({ label: `${role} exists`, ok: false });
      continue;
    }
    checks.push({ label: `${role} can sign in`, ok: info.login });
    checks.push({
      label: `${role} has no admin attributes or broad role memberships`,
      ok: !info.superuser && !info.createrole && !info.createdb && !info.privileged,
    });
    const [can] = await prisma.$queryRaw<[{ create: boolean; ddl: boolean }]>`
      SELECT has_schema_privilege(${role}, 'public', 'CREATE') AS create,
        EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner = ${role}) AS ddl`;
    checks.push({ label: `${role} can't create, alter or drop tables`, ok: !can.create && !can.ddl });
  }
  // The per-table checks below need both roles to exist.
  if (checks.some((c) => !c.ok && c.label.endsWith(' exists'))) return checks;

  const table = (name: string) => `public.${quoteIdent(name)}`;
  const may = async (role: Role, name: string, privilege: string) => {
    const [row] = await prisma.$queryRaw<[{ ok: boolean }]>`SELECT has_table_privilege(${role}, ${table(name)}, ${privilege}) AS ok`;
    return row.ok;
  };

  const tables = (await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename::text AS tablename FROM pg_tables WHERE schemaname = 'public'`).map((t) => t.tablename);

  const undecided = tables.filter((t) => t !== MIGRATIONS_TABLE && !APPEND_ONLY.includes(t) && !READ_WRITE.includes(t));
  checks.push({
    label: `Every table is listed as APPEND_ONLY or READ_WRITE in this script${undecided.length ? ` (not listed: ${undecided.join(', ')})` : ''}`,
    ok: undecided.length === 0,
  });
  const appTables = tables.filter((t) => t !== MIGRATIONS_TABLE);

  const appMissing: string[] = [];
  for (const name of appTables) {
    const needed = APPEND_ONLY.includes(name) ? ['SELECT', 'INSERT'] : ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
    for (const privilege of needed) if (!(await may(APP_ROLE, name, privilege))) appMissing.push(`${name} ${privilege}`);
  }
  checks.push({
    label: `${APP_ROLE} can read and write every app table${appMissing.length ? ` (missing: ${appMissing.join(', ')})` : ''}`,
    ok: appMissing.length === 0,
  });

  const rewritable: string[] = [];
  for (const name of APPEND_ONLY) {
    for (const privilege of ['UPDATE', 'DELETE', 'TRUNCATE']) if (await may(APP_ROLE, name, privilege)) rewritable.push(`${name} ${privilege}`);
  }
  checks.push({
    label: `${APP_ROLE} can only add to ${APPEND_ONLY.join(', ')}${rewritable.length ? ` (also has: ${rewritable.join(', ')})` : ''}`,
    ok: rewritable.length === 0,
  });
  checks.push({
    label: `${APP_ROLE} can't read or change the migration history`,
    ok: !(await may(APP_ROLE, MIGRATIONS_TABLE, 'SELECT')) && !(await may(APP_ROLE, MIGRATIONS_TABLE, 'INSERT')),
  });
  const [purge] = await prisma.$queryRaw<[{ ok: boolean }]>`
    SELECT has_function_privilege(${APP_ROLE}, 'purge_expired_login_audit()', 'EXECUTE') AS ok`;
  checks.push({ label: `${APP_ROLE} can run the sign-in audit retention purge`, ok: purge.ok });

  const readonlyWrites: string[] = [];
  const readonlyMissing: string[] = [];
  for (const name of tables) {
    if (!(await may(READONLY_ROLE, name, 'SELECT'))) readonlyMissing.push(name);
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
      if (await may(READONLY_ROLE, name, privilege)) readonlyWrites.push(`${name} ${privilege}`);
    }
  }
  checks.push({
    label: `${READONLY_ROLE} can read every table${readonlyMissing.length ? ` (missing: ${readonlyMissing.join(', ')})` : ''}`,
    ok: readonlyMissing.length === 0,
  });
  checks.push({
    label: `${READONLY_ROLE} can't change anything${readonlyWrites.length ? ` (has: ${readonlyWrites.join(', ')})` : ''}`,
    ok: readonlyWrites.length === 0,
  });
  return checks;
}

async function main() {
  const rolesWithNewLogin = CHECK_ONLY ? [] : await setUp();

  const checks = await report();
  for (const check of checks) console.log(`${check.ok ? 'ok  ' : 'FAIL'}  ${check.label}`);

  for (const role of rolesWithNewLogin) {
    console.log(`\nPassword set for ${role} (from ${ROLES[role]}). Connection strings, with ${LOGIN_PLACEHOLDER} standing for it:`);
    console.log(`  pooled: ${connectionStringFor(role, true)}`);
    console.log(`  direct: ${connectionStringFor(role, false)}`);
  }
  if (rolesWithNewLogin.includes(APP_ROLE)) {
    console.log(`\nPut the pooled one, with the real password, in DATABASE_URL on the backend host. Keep DIRECT_URL on the owner (migrations).`);
  }

  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool?.end();
  });
