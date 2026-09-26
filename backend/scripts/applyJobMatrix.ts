// Applies the job order matrix (prisma/seeds/data/jobOrderMatrix.json) to one
// live service category, or restores a category from a backup this script
// wrote. Every change runs in one transaction; without --apply it is rolled
// back at the end, so a dry run exercises the real validation and writes.
//
// Usage (from backend/, DATABASE_URL pointing at the target database):
//   npx tsx scripts/applyJobMatrix.ts --category "Home Appliance & Aircon Repair"            # dry run
//   npx tsx scripts/applyJobMatrix.ts --category "Home Appliance & Aircon Repair" --apply    # writes; saves a backup first
//   npx tsx scripts/applyJobMatrix.ts --restore <backup.json> [--apply]                      # puts a category back
//   Optional: --backup-dir <dir> (default: ./job-matrix-backups)
//             --neon-websocket  connect through Neon's WebSocket proxy on port 443,
//               for networks that block the Postgres protocol. Needs
//               `npm i --no-save @prisma/adapter-neon @neondatabase/serverless ws`.
//
// What --category does, per the rollout decisions (2026-09-25):
//   - Writes the category's jobs and questions through the same code as the
//     admin editor (adminCatalogController.writeCatalog). A live job listed as
//     a row's "replaces" is renamed in place, so worker selections and past
//     bookings stay attached; live jobs with no row are deactivated.
//   - Worker prices reset to the new standard price (flat or per unit) for
//     every worker offering a renamed job; every VERIFIED worker in the
//     category is signed up for the new jobs at the standard price.
//   - Worker "match" choices (e.g. Appliance type) are carried over to the
//     new matching question by option text.
//   - City price caps (PricingRule) for the category are widened to ₱0 up to
//     the most expensive possible booking, so new prices aren't rejected.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { PrismaClient, type Prisma, type TaskPricingModel } from '@prisma/client';
import defaultPrisma from '@config/database';
import { validateCatalog, writeCatalog } from '@controllers/adminCatalogController';
import { checkDoleFloor } from '@services/pricingRuleService';
import { getHighestDoleWageReference } from '@/constants/doleWageReference';
import { buildMatrixPayload, loadMatrix, matrixCapMax, type MatrixCategory } from '../prisma/seeds/lib/jobMatrix';

// Old matching-option text -> new option text, where the wording changed.
const OPTION_ALIASES: Record<string, string> = {
  'oven/stove': 'stove or oven',
  'air conditioner': 'aircon',
};

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
  // Optional dependencies, installed only where this flag is needed.
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
    include: {
      tasks: true,
      scopeFields: { include: { options: { include: { workerCapabilities: true } }, taskLinks: true } },
    },
  });
  if (!category) throw new Error(`No service category named "${name}".`);
  const taskIds = category.tasks.map((t) => t.id);
  const [workerTaskPrices, workerTaskSelections, workerTaskTierPrices, pricingRules, workerCategories] = await Promise.all([
    tx.workerTaskPrice.findMany({ where: { serviceTaskId: { in: taskIds } } }),
    tx.workerTaskSelection.findMany({ where: { serviceTaskId: { in: taskIds } } }),
    tx.workerTaskTierPrice.findMany({ where: { serviceTaskId: { in: taskIds } } }),
    tx.pricingRule.findMany({ where: { serviceType: { equals: name, mode: 'insensitive' } } }),
    tx.workerServiceCategory.findMany({ where: { serviceTypeId: category.id } }),
  ]);
  return { category, workerTaskPrices, workerTaskSelections, workerTaskTierPrices, pricingRules, workerCategories };
}
type Snapshot = Awaited<ReturnType<typeof loadCategory>>;

async function applyCategory(tx: Prisma.TransactionClient, matrix: MatrixCategory, report: string[]) {
  const before = await loadCategory(tx, matrix.name);
  const { category } = before;
  const liveByName = new Map(category.tasks.map((t) => [t.name, t]));

  // --- build the same payload the admin editor would send ---------------------
  const { body, warnings, unmatched, jobRef } = buildMatrixPayload(matrix, category, category.tasks);
  const { tasks, scopeFields } = body as Required<typeof body>;
  const usedLive = new Set(category.tasks.filter((t) => !unmatched.includes(t)).map((t) => t.id));
  for (const w of warnings) report.push(`  ! ${w}`);
  const unmatchedCounted = unmatched.filter((t) => t.pricingModel === 'PER_UNIT' || t.pricingModel === 'TIERED');
  if (unmatchedCounted.length) {
    throw new Error(`Live per-unit job(s) with no matrix row need a manual decision: ${unmatchedCounted.map((t) => t.name).join(', ')}.`);
  }

  const invalid = validateCatalog(
    body,
    new Set(category.tasks.map((t) => t.id)),
    new Set(category.scopeFields.map((f) => f.id))
  );
  if (invalid) throw new Error(`Matrix fails the editor's validation: ${invalid}`);
  for (const t of tasks) {
    if (t.pricingModel === 'CUSTOM_QUOTE' || t.isActive === false) continue;
    const dole = checkDoleFloor(getHighestDoleWageReference(), t.basePrice!, undefined);
    if (dole.blocked) throw new Error(`Job "${t.name}": ${dole.message}`);
  }

  // --- write jobs + questions ---------------------------------------------------
  const { taskIdByRef } = await writeCatalog(
    tx,
    { id: category.id, tasks: category.tasks.map((t) => ({ id: t.id, pricingModel: t.pricingModel })) },
    body
  );

  report.push(`  Jobs (${matrix.jobs.length}):`);
  for (const [i, job] of matrix.jobs.entries()) {
    const live = job.replaces ? liveByName.get(job.replaces) : undefined;
    const price = job.pricingModel === 'CUSTOM_QUOTE' ? 'quote' : `${peso(job.price!)} per ${job.unit}`;
    const was = live ? `was "${live.name}" ${live.pricingModel} ${peso(live.basePrice)}` : 'NEW';
    report.push(`    ${String(i + 1).padStart(2)}. ${job.name} — ${price} (${was})`);
  }
  for (const live of category.tasks.filter((t) => !usedLive.has(t.id))) {
    report.push(`    –  ${live.name} — deactivated (no matching row)`);
  }
  report.push(`  Questions: ${category.scopeFields.length} old removed, ${scopeFields.length} new (${matrix.commonQuestions.length} common).`);

  // --- carry worker "match" choices to the new matching questions ---------------
  const newFields = await tx.serviceScopeField.findMany({
    where: { serviceTypeId: category.id, usedForMatching: true },
    include: { options: true },
  });
  let kept = 0;
  const lost: string[] = [];
  const capabilityRows: { workerProfileId: string; optionId: string }[] = [];
  for (const oldField of before.category.scopeFields.filter((f) => f.usedForMatching)) {
    const target = newFields.find((f) => f.label.toLowerCase() === oldField.label.toLowerCase());
    for (const opt of oldField.options) {
      if (!opt.workerCapabilities.length) continue;
      const wanted = OPTION_ALIASES[opt.label.toLowerCase()] ?? opt.label.toLowerCase();
      const newOpt = target?.options.find((o) => o.label.toLowerCase() === wanted);
      if (!newOpt) {
        lost.push(`${oldField.label}: ${opt.label} (${opt.workerCapabilities.length} worker${opt.workerCapabilities.length === 1 ? '' : 's'})`);
        continue;
      }
      for (const cap of opt.workerCapabilities) capabilityRows.push({ workerProfileId: cap.workerProfileId, optionId: newOpt.id });
    }
  }
  if (capabilityRows.length) kept = (await tx.workerScopeFieldCapability.createMany({ data: capabilityRows, skipDuplicates: true })).count;
  report.push(`  Worker match choices: ${kept} carried over${lost.length ? `; not carried (option removed): ${lost.join(', ')}` : ''}.`);

  // --- worker prices: reset to standard; sign verified workers up for new jobs ----
  const verifiedWorkers = before.workerCategories.filter((w) => w.status === 'VERIFIED').map((w) => w.workerProfileId);
  let priced = 0;
  let signedUp = 0;
  for (const [i, job] of matrix.jobs.entries()) {
    const live = job.replaces ? liveByName.get(job.replaces) : undefined;
    const taskId = taskIdByRef.get(jobRef(i))!;
    const workers = live
      ? [
          ...new Set([
            ...before.workerTaskSelections.filter((s) => s.serviceTaskId === live.id && s.isActive).map((s) => s.workerProfileId),
            ...before.workerTaskPrices.filter((p) => p.serviceTaskId === live.id && p.isActive).map((p) => p.workerProfileId),
          ]),
        ]
      : verifiedWorkers;
    for (const workerProfileId of workers) {
      await tx.workerTaskSelection.upsert({
        where: { workerProfileId_serviceTaskId: { workerProfileId, serviceTaskId: taskId } },
        update: { isActive: true },
        create: { workerProfileId, serviceTaskId: taskId },
      });
      if (job.pricingModel === 'CUSTOM_QUOTE') {
        await tx.workerTaskPrice.deleteMany({ where: { workerProfileId, serviceTaskId: taskId } });
      } else {
        const data = job.pricingModel === 'FIXED' ? { price: job.price!, unitPrice: null } : { price: null, unitPrice: job.price! };
        await tx.workerTaskPrice.upsert({
          where: { workerProfileId_serviceTaskId: { workerProfileId, serviceTaskId: taskId } },
          update: { ...data, isActive: true },
          create: { workerProfileId, serviceTaskId: taskId, ...data },
        });
        priced++;
      }
      if (!live) signedUp++;
    }
  }
  report.push(
    `  Worker prices: ${priced} set to the standard price; ${signedUp} new-job sign-up${signedUp === 1 ? '' : 's'} (${verifiedWorkers.length} verified worker${verifiedWorkers.length === 1 ? '' : 's'} in category).`
  );

  // --- widen city price caps -------------------------------------------------------
  const settings = await tx.appSettings.findFirst();
  const topTier = Math.max(settings?.tierProMultiplier ?? 1.15, settings?.tierExpertMultiplier ?? 1.3);
  const capMax = matrixCapMax(matrix, topTier);
  for (const rule of before.pricingRules) {
    const maxPrice = Math.max(rule.maxPrice, capMax);
    await tx.pricingRule.update({ where: { id: rule.id }, data: { minPrice: 0, maxPrice } });
    report.push(`  City cap ${rule.city}: ${peso(rule.minPrice)}–${peso(rule.maxPrice)} → ${peso(0)}–${peso(maxPrice)}`);
  }
  if (!before.pricingRules.length) report.push('  City caps: none for this category.');

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

  // Jobs the apply created can't be deleted if a booking used them: switch them off.
  const created = current.tasks.filter((t) => !oldTaskIds.has(t.id));
  if (created.length) {
    await tx.serviceTask.updateMany({ where: { id: { in: created.map((t) => t.id) } }, data: { isActive: false, quantityScopeFieldId: null } });
    await tx.workerTaskSelection.updateMany({ where: { serviceTaskId: { in: created.map((t) => t.id) } }, data: { isActive: false } });
    await tx.workerTaskPrice.updateMany({ where: { serviceTaskId: { in: created.map((t) => t.id) } }, data: { isActive: false } });
  }

  // Questions: drop the current set, recreate the backed-up one with its original ids.
  await tx.serviceTask.updateMany({ where: { serviceTypeId: old.id }, data: { quantityScopeFieldId: null } });
  await tx.serviceScopeField.deleteMany({ where: { serviceTypeId: old.id } });
  for (const f of old.scopeFields) {
    await tx.serviceScopeField.create({
      data: {
        id: f.id,
        serviceTypeId: old.id,
        label: f.label,
        helpText: f.helpText,
        fieldType: f.fieldType,
        required: f.required,
        sortOrder: f.sortOrder,
        minValue: f.minValue,
        maxValue: f.maxValue,
        usedForMatching: f.usedForMatching,
        options: { create: f.options.map((o) => ({ id: o.id, label: o.label, sortOrder: o.sortOrder })) },
        taskLinks: { create: f.taskLinks.map((l) => ({ serviceTaskId: l.serviceTaskId })) },
      },
    });
  }
  const workerIds = new Set((await tx.workerProfile.findMany({ select: { id: true } })).map((w) => w.id));
  const caps = old.scopeFields.flatMap((f) => f.options.flatMap((o) => o.workerCapabilities)).filter((c) => workerIds.has(c.workerProfileId));
  if (caps.length) await tx.workerScopeFieldCapability.createMany({ data: caps.map((c) => ({ id: c.id, workerProfileId: c.workerProfileId, optionId: c.optionId, createdAt: c.createdAt })), skipDuplicates: true });

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
        quantityScopeFieldId: t.quantityScopeFieldId,
        durationHours: t.durationHours,
        isActive: t.isActive,
        sortOrder: t.sortOrder,
      },
    });
  }

  // Worker prices and selections for the old jobs, exactly as they were.
  const ids = [...oldTaskIds];
  await tx.workerTaskPrice.deleteMany({ where: { serviceTaskId: { in: ids } } });
  await tx.workerTaskSelection.deleteMany({ where: { serviceTaskId: { in: ids } } });
  await tx.workerTaskTierPrice.deleteMany({ where: { serviceTaskId: { in: ids } } });
  const live = <T extends { workerProfileId: string }>(rows: T[]) => rows.filter((r) => workerIds.has(r.workerProfileId));
  if (backup.workerTaskPrices.length) await tx.workerTaskPrice.createMany({ data: live(backup.workerTaskPrices) });
  if (backup.workerTaskSelections.length) await tx.workerTaskSelection.createMany({ data: live(backup.workerTaskSelections) });
  if (backup.workerTaskTierPrices.length) await tx.workerTaskTierPrice.createMany({ data: live(backup.workerTaskTierPrices) });

  for (const rule of backup.pricingRules) {
    await tx.pricingRule.updateMany({ where: { id: rule.id }, data: { minPrice: rule.minPrice, maxPrice: rule.maxPrice } });
  }

  report.push(
    `  Restored ${old.tasks.length} jobs, ${old.scopeFields.length} questions, ${caps.length} match choices, ` +
      `${backup.workerTaskPrices.length} worker prices, ${backup.pricingRules.length} city caps; ${created.length} added job(s) switched off.`
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
      // Backup is read and written before anything changes.
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
