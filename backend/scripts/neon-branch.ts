// Creates (or switches to) an isolated Neon branch and points this
// machine's backend/.env at it — the fix for the shared-dev-DB collision
// risk documented in project memory (multiple sessions/agents hitting the
// same "production" branch directly). Each branch is a cheap,
// copy-on-write snapshot of the parent, so this is near-instant and free
// to create liberally: one per dev session/feature, thrown away when done.
//
// Usage (from backend/):
//   npx tsx scripts/neon-branch.ts create [name]   # new branch off production, switches .env to it
//   npx tsx scripts/neon-branch.ts switch <name>    # point .env at an EXISTING branch (no create)
//   npx tsx scripts/neon-branch.ts list             # list all branches
//   npx tsx scripts/neon-branch.ts delete <name>    # delete a branch (never "production")
//
// Requires NEON_API_KEY in backend/.env (console.neon.tech -> Account/Org
// Settings -> API Keys). Shells out to `npx neonctl` — no extra
// devDependency, ~5s slower on first run per machine while npx fetches it.
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

const PROJECT_ID = 'floral-lake-80894687'; // Neon project "HomeEase" — not sensitive, just an id
const PARENT_BRANCH = 'production'; // the one shared branch this project has today
const DATABASE_NAME = 'neondb';
const ENV_PATH = path.resolve(__dirname, '..', '.env');

function neon(args: string[]): string {
  if (!process.env.NEON_API_KEY) {
    console.error('NEON_API_KEY is not set — add it to backend/.env (console.neon.tech -> API Keys).');
    process.exit(1);
  }
  // The API key rides in via env (neonctl reads NEON_API_KEY itself), not
  // as a --api-key argument — keeps it out of the shell-joined argv below
  // and out of `ps`/process-list output.
  return execFileSync('npx', ['neonctl', ...args], {
    encoding: 'utf8',
    env: process.env,
    // Windows needs shell:true to resolve npx.cmd; harmless here since
    // every argument is either a fixed constant or a branch name we control.
    // Node prints a DEP0190 warning regardless (shell:true + an args array
    // is deprecated in general, even with nothing unsafe in it) — cosmetic,
    // not a real risk given the argument contents above.
    shell: true,
  });
}

function connectionStrings(branchName: string): { database: string; direct: string } {
  const database = neon([
    'connection-string', branchName,
    '--project-id', PROJECT_ID,
    '--database-name', DATABASE_NAME,
    '--pooled', '--prisma',
  ]).trim();
  const direct = neon([
    'connection-string', branchName,
    '--project-id', PROJECT_ID,
    '--database-name', DATABASE_NAME,
    '--prisma',
  ]).trim();
  return { database, direct };
}

// Replaces DATABASE_URL=/DIRECT_URL= in .env with the given values.
// Aborts instead of guessing if either key doesn't appear EXACTLY once —
// see the "duplicate DATABASE_URL hazard" this project has hit before.
function switchEnvTo(branchName: string, urls: { database: string; direct: string }) {
  const original = readFileSync(ENV_PATH, 'utf8');

  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    const count = (original.match(new RegExp(`^${key}=`, 'gm')) ?? []).length;
    if (count !== 1) {
      console.error(
        `Aborting: expected exactly one "${key}=" line in .env, found ${count}. ` +
          `Fix .env by hand first (see the duplicate-DATABASE_URL note in project memory) — not touching it.`
      );
      process.exit(1);
    }
  }

  const backupPath = `${ENV_PATH}.bak.${Date.now()}`;
  writeFileSync(backupPath, original);

  const updated = original
    .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${urls.database}`)
    .replace(/^DIRECT_URL=.*$/m, `DIRECT_URL=${urls.direct}`);
  writeFileSync(ENV_PATH, updated);

  console.log(`Switched backend/.env to branch "${branchName}".`);
  console.log(`(previous .env backed up to ${path.basename(backupPath)} — restore by copying it back over .env)`);
  console.log('Restart `npm run dev` / re-run `npx prisma migrate deploy` if it was already running.');
}

function main() {
  const [cmd, arg] = process.argv.slice(2);

  if (cmd === 'list') {
    console.log(neon(['branches', 'list', '--project-id', PROJECT_ID, '--output', 'json']));
    return;
  }

  if (cmd === 'create') {
    const name = arg ?? `dev-${process.env.USERNAME ?? process.env.USER ?? 'session'}-${new Date().toISOString().slice(0, 10)}`;
    console.log(`Creating branch "${name}" off "${PARENT_BRANCH}"...`);
    neon(['branches', 'create', '--project-id', PROJECT_ID, '--parent', PARENT_BRANCH, '--name', name]);
    switchEnvTo(name, connectionStrings(name));
    return;
  }

  if (cmd === 'switch') {
    if (!arg) {
      console.error('Usage: neon-branch.ts switch <branch-name>');
      process.exit(1);
    }
    switchEnvTo(arg, connectionStrings(arg));
    return;
  }

  if (cmd === 'delete') {
    if (!arg || arg === PARENT_BRANCH) {
      console.error(`Usage: neon-branch.ts delete <branch-name> (refusing to delete "${PARENT_BRANCH}")`);
      process.exit(1);
    }
    neon(['branches', 'delete', arg, '--project-id', PROJECT_ID]);
    console.log(`Deleted branch "${arg}". backend/.env was NOT changed — switch to another branch if it was pointed here.`);
    return;
  }

  console.error('Usage: neon-branch.ts <create [name] | switch <name> | list | delete <name>>');
  process.exit(1);
}

if (!existsSync(ENV_PATH)) {
  console.error(`No backend/.env found at ${ENV_PATH}`);
  process.exit(1);
}

main();
