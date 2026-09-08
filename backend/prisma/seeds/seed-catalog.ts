// prisma/seeds/seed-catalog.ts
//
// Prod-safe catalog bootstrap. Inserts ONLY reference data the app needs to
// function — service categories, their tasks, custom scope fields, and
// per-city pricing rules. No users, no bookings, no wipe. Fully idempotent:
// every write is an upsert / skip-if-exists, so re-running it is a no-op.
//
// AppSettings is deliberately NOT touched here — if the singleton row is
// missing, seed elsewhere or let the app create it.
//
// Run with: npx tsx prisma/seeds/seed-catalog.ts   (from the backend folder)

import "dotenv/config";
import { PrismaClient, ServiceScopeType, ScopeFieldType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const CITIES = [
  "Plaridel", "Malolos", "San Fernando", "Angeles City", "Quezon City",
  "Manila", "Makati", "Pasig", "Marikina", "Caloocan", "Taguig", "Bulacan",
];

type ScopeFieldSeed = {
  label: string;
  fieldType: ScopeFieldType;
  required: boolean;
  sortOrder: number;
  options?: string[];
};

const CATEGORIES: Array<{
  name: string;
  description: string;
  basePrice: number;
  icon: string;
  scopeType?: ServiceScopeType;
  hasCondition?: boolean;
  tasks: { name: string; description?: string; basePrice: number; durationHours: number }[];
  scopeFields?: ScopeFieldSeed[];
}> = [
  {
    name: "Plumbing",
    description: "Pipe repairs, installations, and leak fixes",
    basePrice: 350,
    icon: "water-outline",
    tasks: [
      { name: "Leak Repair", description: "Locate and seal an active pipe or fixture leak.", basePrice: 350, durationHours: 1.5 },
      { name: "Pipe Installation", basePrice: 800, durationHours: 3 },
      { name: "Drain Unclogging", basePrice: 400, durationHours: 1 },
    ],
  },
  {
    name: "Electrical",
    description: "Wiring, fixture installs, and electrical troubleshooting",
    basePrice: 400,
    icon: "flash-outline",
    tasks: [
      { name: "Outlet Installation", description: "Install or replace a wall outlet.", basePrice: 300, durationHours: 1 },
      { name: "Circuit Breaker Repair", basePrice: 600, durationHours: 2 },
      { name: "Lighting Fixture Setup", basePrice: 450, durationHours: 1.5 },
    ],
  },
  {
    name: "Cleaning",
    description: "Home and post-construction cleaning services",
    basePrice: 500,
    icon: "sparkles-outline",
    tasks: [
      { name: "General Home Cleaning", description: "Whole-home sweep, mop, dust, and surface wipe-down.", basePrice: 500, durationHours: 3 },
      { name: "Deep Cleaning", basePrice: 900, durationHours: 5 },
      { name: "Post-Construction Cleanup", basePrice: 1200, durationHours: 6 },
    ],
  },
  {
    name: "Carpentry",
    description: "Furniture repair, custom builds, and woodwork",
    basePrice: 450,
    icon: "hammer-outline",
    tasks: [
      { name: "Furniture Repair", description: "Fix loose joints, hinges, or broken panels.", basePrice: 450, durationHours: 2 },
      { name: "Custom Shelving", basePrice: 1000, durationHours: 4 },
      { name: "Door/Window Framing", basePrice: 800, durationHours: 3 },
    ],
  },
  {
    name: "Painting",
    description: "Interior and exterior painting services",
    basePrice: 600,
    icon: "color-palette-outline",
    tasks: [
      { name: "Room Painting", description: "Prep, prime, and paint one room.", basePrice: 600, durationHours: 4 },
      { name: "Exterior Wall Painting", basePrice: 1500, durationHours: 8 },
      { name: "Touch-Up Painting", basePrice: 300, durationHours: 1.5 },
    ],
  },
  {
    name: "Appliance Repair",
    description: "Washing machine, oven, and general appliance repair",
    basePrice: 450,
    icon: "build-outline",
    scopeType: ServiceScopeType.CUSTOM,
    hasCondition: false,
    tasks: [
      { name: "Washing Machine Repair", description: "Diagnose and fix a washing machine fault.", basePrice: 550, durationHours: 2 },
      { name: "Oven/Stove Repair", basePrice: 500, durationHours: 2 },
      { name: "General Appliance Diagnosis", basePrice: 300, durationHours: 1 },
    ],
    scopeFields: [
      {
        label: "Appliance Type",
        fieldType: ScopeFieldType.SELECT,
        required: true,
        sortOrder: 0,
        options: ["Washing Machine", "Refrigerator", "Oven/Stove", "Air Conditioner", "Microwave"],
      },
    ],
  },
  {
    name: "Pest Control",
    description: "Termite, rodent, and general pest treatment",
    basePrice: 700,
    icon: "bug-outline",
    scopeType: ServiceScopeType.CUSTOM,
    hasCondition: true,
    tasks: [
      { name: "Termite Treatment", description: "Inspect and treat an active termite infestation.", basePrice: 1200, durationHours: 3 },
      { name: "Rodent Control", basePrice: 700, durationHours: 2 },
      { name: "General Pest Spraying", basePrice: 500, durationHours: 1.5 },
    ],
    scopeFields: [
      {
        label: "Pest Type",
        fieldType: ScopeFieldType.MULTI_SELECT,
        required: true,
        sortOrder: 0,
        options: ["Termites", "Rodents", "Cockroaches", "Ants", "Bed Bugs"],
      },
      { label: "Affected Areas", fieldType: ScopeFieldType.TEXT, required: false, sortOrder: 1 },
    ],
  },
];

async function main() {
  let createdTypes = 0;
  let skippedTypes = 0;
  let createdRules = 0;

  for (const [i, cat] of CATEGORIES.entries()) {
    const existing = await prisma.serviceType.findUnique({ where: { name: cat.name } });

    if (existing) {
      skippedTypes++;
      console.log(`  = ServiceType "${cat.name}" already exists — skipped`);
    } else {
      await prisma.serviceType.create({
        data: {
          name: cat.name,
          description: cat.description,
          basePrice: cat.basePrice,
          isActive: true,
          icon: cat.icon,
          scopeType: cat.scopeType ?? ServiceScopeType.ROOM_BASED,
          hasCondition: cat.hasCondition ?? true,
          tasks: { create: cat.tasks },
          scopeFields: cat.scopeFields
            ? {
                create: cat.scopeFields.map((f) => ({
                  label: f.label,
                  fieldType: f.fieldType,
                  required: f.required,
                  sortOrder: f.sortOrder,
                  options: f.options
                    ? { create: f.options.map((label, idx) => ({ label, sortOrder: idx })) }
                    : undefined,
                })),
              }
            : undefined,
        },
      });
      createdTypes++;
      console.log(`  + ServiceType "${cat.name}" (${cat.tasks.length} tasks${cat.scopeFields ? `, ${cat.scopeFields.length} scope fields` : ""})`);
    }

    // Deterministic 3-city window per category so re-runs don't accumulate rules.
    const cities = [CITIES[i % CITIES.length], CITIES[(i + 1) % CITIES.length], CITIES[(i + 2) % CITIES.length]];
    for (const city of cities) {
      const res = await prisma.pricingRule.upsert({
        where: { city_serviceType: { city, serviceType: cat.name } },
        update: {},
        create: {
          city,
          serviceType: cat.name,
          minPrice: Math.round(cat.basePrice * 0.8),
          maxPrice: Math.round(cat.basePrice * 1.6),
        },
      });
      if (res.createdAt.getTime() === res.updatedAt.getTime()) createdRules++;
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
