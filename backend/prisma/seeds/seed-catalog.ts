// prisma/seeds/seed-catalog.ts
//
// Prod-safe catalog bootstrap. Inserts ONLY reference data the app needs to
// function — service categories built from the job order matrix
// (prisma/seeds/data/jobOrderMatrix.json: jobs, units, prices, common and
// per-job booking questions) plus per-city price caps. No users, no bookings,
// no wipe. Fully idempotent: an existing category or cap is skipped, so
// re-running it is a no-op. To move an existing category onto the matrix, use
// scripts/applyJobMatrix.ts instead.
//
// Categories are written through the admin editor's own save
// (adminCatalogController.writeCatalog), so they come out exactly as if an
// admin had entered them.
//
// AppSettings is deliberately NOT touched here — if the singleton row is
// missing, seed elsewhere or let the app create it.
//
// Run with: npx tsx prisma/seeds/seed-catalog.ts   (from the backend folder)

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { validateCatalog, writeCatalog } from "../../src/controllers/adminCatalogController";
import { buildMatrixPayload, loadMatrix, matrixCapMax } from "./lib/jobMatrix";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const CITIES = [
  "Plaridel", "Malolos", "San Fernando", "Angeles City", "Quezon City",
  "Manila", "Makati", "Pasig", "Marikina", "Caloocan", "Taguig", "Bulacan",
];

// Top worker-tier multiplier used for the city caps when AppSettings is
// missing (matches its schema default).
const DEFAULT_TOP_TIER = 1.3;

const CATEGORY_DETAILS: Record<string, { description: string; icon: string }> = {
  "Home Appliance & Aircon Repair": { description: "Diagnosis, repair and cleaning for household appliances and aircon units", icon: "build-outline" },
  "Plumbing Repair": { description: "Leak, clog, fixture and water-system work", icon: "water-outline" },
  "Electrical Repair": { description: "Wiring, fixture installs and electrical troubleshooting", icon: "flash-outline" },
  "Carpentry & Furniture Repair": { description: "Furniture repair, doors, cabinets and custom woodwork", icon: "hammer-outline" },
  "House Painting": { description: "Interior, exterior and metal painting", icon: "color-palette-outline" },
  "Pest Control": { description: "Termite, rodent and general pest treatment", icon: "bug-outline" },
  "Home Cleaning": { description: "Standard, deep and specialty home cleaning", icon: "sparkles-outline" },
  "Laundry & Ironing": { description: "Wash, fold and ironing priced by basket", icon: "shirt-outline" },
  "Device Repair": { description: "Computer and laptop repair, software and networking", icon: "desktop-outline" },
};

async function main() {
  const matrix = loadMatrix();
  const settings = await prisma.appSettings.findFirst();
  const topTier = Math.max(settings?.tierProMultiplier ?? 1.15, settings?.tierExpertMultiplier ?? DEFAULT_TOP_TIER);
  let createdTypes = 0;
  let skippedTypes = 0;
  let createdRules = 0;

  for (const [i, cat] of matrix.entries()) {
    const details = CATEGORY_DETAILS[cat.name];
    if (!details) throw new Error(`No description/icon for "${cat.name}" in CATEGORY_DETAILS.`);

    const existing = await prisma.serviceType.findUnique({ where: { name: cat.name } });
    if (existing) {
      skippedTypes++;
      console.log(`  = ServiceType "${cat.name}" already exists — skipped`);
    } else {
      const { body } = buildMatrixPayload(cat, { name: cat.name, ...details, requiresCertification: false });
      const invalid = validateCatalog(body, new Set(), new Set());
      if (invalid) throw new Error(`"${cat.name}" fails the editor's validation: ${invalid}`);
      await prisma.$transaction((tx) => writeCatalog(tx, null, body), { timeout: 120_000, maxWait: 10_000 });
      createdTypes++;
      console.log(`  + ServiceType "${cat.name}" (${body.tasks!.length} jobs, ${body.scopeFields!.length} questions)`);
    }

    // Deterministic 3-city window per category so re-runs don't accumulate
    // caps. ₱0 minimum: custom-quote jobs total ₱0 at booking.
    const cities = [CITIES[i % CITIES.length], CITIES[(i + 1) % CITIES.length], CITIES[(i + 2) % CITIES.length]];
    for (const city of cities) {
      const key = { city_serviceType: { city, serviceType: cat.name } };
      if (await prisma.pricingRule.findUnique({ where: key })) continue;
      await prisma.pricingRule.create({ data: { city, serviceType: cat.name, minPrice: 0, maxPrice: matrixCapMax(cat, topTier) } });
      createdRules++;
    }
  }

  const totalTypes = await prisma.serviceType.count();
  const totalTasks = await prisma.serviceTask.count();
  const totalRules = await prisma.pricingRule.count();
  console.log(
    `\nDone. Created ${createdTypes} service types (${skippedTypes} already present), ${createdRules} new pricing rules.\n` +
      `Catalog totals now: ${totalTypes} service types, ${totalTasks} tasks, ${totalRules} pricing rules.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
