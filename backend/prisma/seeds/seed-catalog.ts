// prisma/seeds/seed-catalog.ts
//
// Prod-safe catalog bootstrap. Inserts ONLY reference data the app needs to
// function — service categories built from the job order matrix
// (prisma/seeds/data/jobOrderMatrix.json: jobs, units, prices, common and
// per-job booking questions). No users, no bookings,
// no wipe. Fully idempotent: an existing category is skipped, so
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
import { buildMatrixPayload, loadMatrix } from "./lib/jobMatrix";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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
  let createdTypes = 0;
  let skippedTypes = 0;

  for (const cat of matrix) {
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
  }

  const totalTypes = await prisma.serviceType.count();
  const totalTasks = await prisma.serviceTask.count();
  console.log(
    `\nDone. Created ${createdTypes} service types (${skippedTypes} already present).\n` +
      `Catalog totals now: ${totalTypes} service types, ${totalTasks} tasks.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
