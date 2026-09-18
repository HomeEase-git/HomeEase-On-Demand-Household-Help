// prisma/seeds/backfill-worker-task-prices.ts
//
// Run once, after Stage 2 (worker task-price CRUD) ships and BEFORE Stage 3
// (pricing engine rewire) goes live. Once Stage 3 ships, a worker with no
// WorkerTaskPrice row for a FIXED/PER_UNIT task they're connected to becomes
// unbookable for it — since no worker has manually set anything on day one,
// every currently-bookable worker would go dark for every service they
// currently offer without this backfill running first.
//
// For each worker's connected service type, upserts a WorkerTaskPrice from
// the task's own basePrice:
//   - FIXED:      price = task.basePrice        (a real, sensible flat price)
//   - PER_UNIT:   unitPrice = task.basePrice     (a PLACEHOLDER rate — a flat
//                 basePrice isn't a meaningful per-unit rate, e.g. "₱500" is
//                 not "₱500/kilo". Flagged separately below for admin/worker
//                 follow-up review — don't treat these as done.)
//   - CUSTOM_QUOTE: nothing to backfill — worker prices on-site.
//
// Idempotent (upsert on the workerProfileId+serviceTaskId unique), safe to
// re-run, matches seed-catalog.ts's style.
//
// Run with:
//   npx tsx prisma/seeds/backfill-worker-task-prices.ts --dry-run   (counts only)
//   npx tsx prisma/seeds/backfill-worker-task-prices.ts             (writes for real)

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  const workers = await prisma.workerProfile.findMany({
    select: {
      id: true,
      userId: true,
      serviceCategories: {
        select: {
          serviceType: {
            select: {
              tasks: {
                select: { id: true, name: true, pricingModel: true, basePrice: true },
              },
            },
          },
        },
      },
    },
  });

  let fixedCount = 0;
  let perUnitPlaceholderCount = 0;
  let skippedCustomQuote = 0;
  let skippedAlreadyPriced = 0;
  const perUnitPlaceholders: { workerUserId: string; taskName: string }[] = [];

  for (const worker of workers) {
    const tasks = worker.serviceCategories.flatMap((c) => c.serviceType.tasks);
    for (const task of tasks) {
      if (task.pricingModel === 'CUSTOM_QUOTE') {
        skippedCustomQuote++;
        continue;
      }

      const existing = await prisma.workerTaskPrice.findUnique({
        where: { workerProfileId_serviceTaskId: { workerProfileId: worker.id, serviceTaskId: task.id } },
      });
      if (existing) {
        skippedAlreadyPriced++;
        continue;
      }

      if (task.pricingModel === 'FIXED') {
        fixedCount++;
        if (!isDryRun) {
          await prisma.workerTaskPrice.create({
            data: { workerProfileId: worker.id, serviceTaskId: task.id, price: task.basePrice, isActive: true },
          });
        }
      } else {
        // PER_UNIT
        perUnitPlaceholderCount++;
        perUnitPlaceholders.push({ workerUserId: worker.userId, taskName: task.name });
        if (!isDryRun) {
          await prisma.workerTaskPrice.create({
            data: { workerProfileId: worker.id, serviceTaskId: task.id, unitPrice: task.basePrice, isActive: true },
          });
        }
      }
    }
  }

  console.log(
    `${isDryRun ? '[DRY RUN] Would create' : 'Created'} ${fixedCount} FIXED price(s) and ${perUnitPlaceholderCount} PER_UNIT placeholder rate(s).\n` +
      `Skipped ${skippedCustomQuote} CUSTOM_QUOTE task(s) (nothing to backfill) and ${skippedAlreadyPriced} already-priced row(s).`
  );

  if (perUnitPlaceholders.length > 0) {
    console.log(
      `\n⚠ PER_UNIT placeholders use the task's flat basePrice as a per-unit rate, which is very unlikely to be a` +
        ` sensible real rate (e.g. "₱500" is not "₱500/kilo"). Flag these for admin/worker follow-up review:`
    );
    for (const p of perUnitPlaceholders) {
      console.log(`  - worker ${p.workerUserId} / task "${p.taskName}"`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
