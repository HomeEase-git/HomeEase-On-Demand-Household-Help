import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { PrismaClient, type Prisma, type TaskPricingModel } from '@prisma/client';
import defaultPrisma from '@config/database';
import { validateCatalog, writeCatalog } from '@controllers/adminCatalogController';
import { checkDoleFloor } from '@services/pricingRuleService';
import { getHighestDoleWageReference } from '@/constants/doleWageReference';
import { buildMatrixPayload, loadMatrix, type MatrixCategory } from '../prisma/seeds/lib/jobMatrix';

class DryRunRollback extends Error {}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const APPLY = flag('--apply');
const BACKUP_DIR = path.resolve(option('--backup-dir') ?? 'job-matrix-backups');
const TX_OPTIONS = { timeout: 300_000, maxWait: 20_000 };

function makeClient(): PrismaClient {
  if (!flag('--neon-websocket')) return defaultPrisma;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { PrismaNeon } = require('@prisma/adapter-neon');
  const { neonConfig } = require('@neondatabase/serverless');
  neonConfig.webSocketConstructor = require('ws');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
}
const prisma = makeClient();

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? '').host;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;

async function loadCategory(tx: Prisma.TransactionClient, name: string) {
  const category = await tx.serviceType.findFirst({
    where: { name },
    include: { tasks: true },
  });
  if (!category) throw new Error(`No service category named "${name}".`);
  const taskIds = category.tasks.map((t) => t.id);
  const [workerTaskSelections, workerCategories] = await Promise.all([
    tx.workerTaskSelection.findMany({ where: { serviceTaskId: { in: taskIds } } }),
    tx.workerServiceCategory.findMany({ where: { serviceTypeId: category.id } }),
  ]);
  return { category, workerTaskSelections, workerCategories };
}
type Snapshot = Awaited<ReturnType<typeof loadCategory>>;

async function applyCategory(tx: Prisma.TransactionClient, matrix: MatrixCategory, report: string[]) {
  const before = await loadCategory(tx, matrix.name);
  const { category } = before;
  const liveByName = new Map(category.tasks.map((t) => [t.name, t]));

  const { body, warnings, unmatched, jobRef } = buildMatrixPayload(matrix, category, category.tasks);
  const { tasks } = body as Required<typeof body>;
  const usedLive = new Set(category.tasks.filter((t) => !unmatched.includes(t)).map((t) => t.id));
  for (const w of warnings) report.push(`  ! ${w}`);
  const unmatchedCounted = unmatched.filter((t) => t.pricingModel === 'PER_UNIT' || t.pricingModel === 'TIERED');
  if (unmatchedCounted.length) {
    throw new Error(`Live per-unit job(s) with no matrix row need a manual decision: ${unmatchedCounted.map((t) => t.name).join(', ')}.`);
  }

  const invalid = validateCatalog(body, new Set(category.tasks.map((t) => t.id)));
  if (invalid) throw new Error(`Matrix fails the editor's validation: ${invalid}`);
  for (const t of tasks) {
    if (t.isActive === false) continue;
    const dole = checkDoleFloor(getHighestDoleWageReference(), t.basePrice!, undefined);
    if (dole.blocked) throw new Error(`Job "${t.name}": ${dole.message}`);
  }

  const { taskIdByRef } = await writeCatalog(
    tx,
    { id: category.id, tasks: category.tasks.map((t) => ({ id: t.id, pricingModel: t.pricingModel })) },
    body
  );

  report.push(`  Jobs (${matrix.jobs.length}):`);
  for (const [i, job] of matrix.jobs.entries()) {
    const live = job.replaces ? liveByName.get(job.replaces) : undefined;
    const price = `${peso(job.price)} per ${job.unit}`;
    const was = live ? `was "${live.name}" ${live.pricingModel} ${peso(live.basePrice)}` : 'NEW';
    report.push(`    ${String(i + 1).padStart(2)}. ${job.name} — ${price} (${was})`);
  }
  for (const live of category.tasks.filter((t) => !usedLive.has(t.id))) {
    report.push(`    –  ${live.name} — deactivated (no matching row)`);
  }
  const verifiedWorkers = before.workerCategories.filter((w) => w.status === 'VERIFIED').map((w) => w.workerProfileId);
  let signedUp = 0;
  for (const [i, job] of matrix.jobs.entries()) {
    const live = job.replaces ? liveByName.get(job.replaces) : undefined;
    const taskId = taskIdByRef.get(jobRef(i))!;
    const workers = live
      ? before.workerTaskSelections.filter((s) => s.serviceTaskId === live.id && s.isActive).map((s) => s.workerProfileId)
      : verifiedWorkers;
    for (const workerProfileId of workers) {
      await tx.workerTaskSelection.upsert({
        where: { workerProfileId_serviceTaskId: { workerProfileId, serviceTaskId: taskId } },
        update: { isActive: true },
        create: { workerProfileId, serviceTaskId: taskId },
      });
      if (!live) signedUp++;
    }
  }
  report.push(
    `  Worker sign-ups: ${signedUp} new-job sign-up${signedUp === 1 ? '' : 's'} (${verifiedWorkers.length} verified worker${verifiedWorkers.length === 1 ? '' : 's'} in category).`
  );

  return before;
}

async function restoreCategory(tx: Prisma.TransactionClient, backup: Snapshot, report: string[]) {
  const old = backup.category;
  const current = await tx.serviceType.findUnique({ where: { id: old.id }, include: { tasks: true } });
  if (!current) throw new Error(`Category ${old.name} (${old.id}) no longer exists.`);
  const oldTaskIds = new Set(old.tasks.map((t) => t.id));

  await tx.serviceType.update({
    where: { id: old.id },
    data: { name: old.name, description: old.description, basePrice: old.basePrice, icon: old.icon, requiresCertification: old.requiresCertification },
  });

  const created = current.tasks.filter((t) => !oldTaskIds.has(t.id));
  if (created.length) {
    await tx.serviceTask.updateMany({ where: { id: { in: created.map((t) => t.id) } }, data: { isActive: false } });
    await tx.workerTaskSelection.updateMany({ where: { serviceTaskId: { in: created.map((t) => t.id) } }, data: { isActive: false } });
  }

  const workerIds = new Set((await tx.workerProfile.findMany({ select: { id: true } })).map((w) => w.id));

  // Jobs back to their old details.
  for (const t of old.tasks) {
    await tx.serviceTask.update({
      where: { id: t.id },
      data: {
        name: t.name,
        description: t.description,
        basePrice: t.basePrice,
        pricingModel: t.pricingModel as TaskPricingModel,
        minPrice: t.minPrice,
        maxPrice: t.maxPrice,
        unitLabel: t.unitLabel,
        ...(t.minQuantity !== undefined ? { minQuantity: t.minQuantity } : {}),
        ...(t.maxQuantity !== undefined ? { maxQuantity: t.maxQuantity } : {}),
        durationHours: t.durationHours,
        isActive: t.isActive,
        sortOrder: t.sortOrder,
      },
    });
  }

  await tx.workerTaskSelection.deleteMany({ where: { serviceTaskId: { in: [...oldTaskIds] } } });
  const selections = backup.workerTaskSelections.filter((r) => workerIds.has(r.workerProfileId));
  if (selections.length) await tx.workerTaskSelection.createMany({ data: selections });

  report.push(
    `  Restored ${old.tasks.length} jobs, ` +
      `${selections.length} worker selections; ${created.length} added job(s) switched off.`
  );
}

async function main() {
  const restorePath = option('--restore');
  const categoryName = option('--category');
  if (!restorePath === !categoryName) {
    console.error('Pass exactly one of --category "<name>" or --restore <backup.json>.');
    process.exit(1);
  }
  console.log(`Database: ${dbHost()}`);
  console.log(APPLY ? 'Mode: APPLY (changes will be committed)' : 'Mode: dry run (everything is rolled back)');

  const report: string[] = [];
  let backupFile: string | null = null;

  if (categoryName) {
    const matrix = loadMatrix().find((c) => c.name === categoryName);
    if (!matrix) throw new Error(`jobOrderMatrix.json has no category "${categoryName}".`);

    if (APPLY) {
      const snapshot = await prisma.$transaction((tx) => loadCategory(tx, categoryName), TX_OPTIONS);
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      backupFile = path.join(BACKUP_DIR, `${categoryName.replace(/[^a-z0-9]+/gi, '-')}-${stamp}.json`);
      fs.writeFileSync(backupFile, JSON.stringify({ takenAt: new Date().toISOString(), database: dbHost(), snapshot }, null, 2));
      console.log(`Backup: ${backupFile}`);
    }

    report.push(`${categoryName}`);
    try {
      await prisma.$transaction(async (tx) => {
        await applyCategory(tx, matrix, report);
        if (!APPLY) throw new DryRunRollback();
      }, TX_OPTIONS);
    } catch (e) {
      if (!(e instanceof DryRunRollback)) throw e;
    }
  } else {
    const { snapshot } = JSON.parse(fs.readFileSync(restorePath!, 'utf8')) as { snapshot: Snapshot };
    report.push(`Restore ${snapshot.category.name} from ${restorePath}`);
    try {
      await prisma.$transaction(async (tx) => {
        await restoreCategory(tx, snapshot, report);
        if (!APPLY) throw new DryRunRollback();
      }, TX_OPTIONS);
    } catch (e) {
      if (!(e instanceof DryRunRollback)) throw e;
    }
  }

  console.log('\n' + report.join('\n'));
  if (APPLY) {
    await prisma.auditLog.create({ data: {
      actorName: 'scripts/applyJobMatrix',
      action: 'SERVICE_TYPE_UPDATED',
      category: 'ADMIN_ACTION',
      level: 'INFO',
      message: `${restorePath ? 'Job order matrix restored' : 'Job order matrix applied'}: ${categoryName ?? restorePath}${backupFile ? ` (backup ${path.basename(backupFile)})` : ''}`,
    } });
    console.log('\nCommitted.');
  } else {
    console.log('\nDry run only: nothing was changed. Re-run with --apply to commit.');
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
