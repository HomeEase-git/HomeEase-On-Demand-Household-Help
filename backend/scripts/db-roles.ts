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
// unless asked. Tables that later migrations add are covered automatically
// (default privileges), except that a new insert-only table must be added to
// APPEND_ONLY below and this script re-run.
//
// Usage (from backend/), with DIRECT_URL = the owner connection:
//   npx tsx scripts/db-roles.ts                    # create missing roles, apply grants, report
//   npx tsx scripts/db-roles.ts --check            # report only, change nothing
//   npx tsx scripts/db-roles.ts --rotate homeease_app   # give that role a new password
//   add --neon-websocket  to connect through Neon's WebSocket proxy (port 443)
//     when the network blocks raw Postgres connections to Neon; needs
//     `npm i --no-save @prisma/adapter-neon @neondatabase/serverless ws`.
// A new password is printed once, with the connection string to use; it is
// not stored anywhere. APP_DB_PASSWORD / READONLY_DB_PASSWORD set a fixed
// password instead (test databases and CI only).
import 'dotenv/config';
import crypto from 'node:crypto';
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
// rewrite who did what or what was paid. Old sign-in audit entries are
// removed through purge_expired_login_audit() instead.
const APPEND_ONLY = ['AuditLog', 'LedgerTransaction', 'LedgerLine'];
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
  const fixed = process.env[ROLES[role]];
  if (fixed) {
    // Goes into a SQL string literal below.
    if (!/^[A-Za-z0-9_.~-]{16,}$/.test(fixed)) {
      throw new Error(`${ROLES[role]} must be at least 16 characters of letters, digits and _.~-`);
    }
    return fixed;
  }
  return crypto.randomBytes(24).toString('hex');
}

/** The connection string for `role`, on the same host and database as the owner's. */
function connectionStringFor(role: Role, password: string, pooled: boolean): string {
  const url = new URL(connectionString!);
  url.username = role;
  url.password = password;
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

async function setUp(): Promise<Map<Role, string>> {
  const newPasswords = new Map<Role, string>();
  const [{ owner, database }] = await prisma.$queryRaw<[{ owner: string; database: string }]>`
    SELECT current_user AS owner, current_database() AS database`;

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  if (!tables.some((t) => t.tablename === 'AuditLog')) {
    throw new Error('No application tables here. Run `npx prisma migrate deploy` first.');
  }

  for (const role of Object.keys(ROLES) as Role[]) {
    const exists = await roleExists(role);
    const setPassword = !exists || ROTATE === role || !!process.env[ROLES[role]];
    const password = setPassword ? passwordFor(role) : '';
    if (!exists) {
      await prisma.$executeRawUnsafe(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    } else if (setPassword) {
      await prisma.$executeRawUnsafe(`ALTER ROLE ${role} PASSWORD '${password}'`);
    }
    if (setPassword && !process.env[ROLES[role]]) newPasswords.set(role, password);
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
  return newPasswords;
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
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'`).map((t) => t.tablename);
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
  const newPasswords = CHECK_ONLY ? new Map<Role, string>() : await setUp();

  const checks = await report();
  for (const check of checks) console.log(`${check.ok ? 'ok  ' : 'FAIL'}  ${check.label}`);

  for (const [role, password] of newPasswords) {
    if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${password}`);
    console.log(`\nNew password for ${role} (shown once, not stored):`);
    console.log(`  pooled: ${connectionStringFor(role, password, true)}`);
    console.log(`  direct: ${connectionStringFor(role, password, false)}`);
  }
  if (newPasswords.has(APP_ROLE)) {
    console.log(`\nSet the pooled one as DATABASE_URL on the backend host. Keep DIRECT_URL on the owner (migrations).`);
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
