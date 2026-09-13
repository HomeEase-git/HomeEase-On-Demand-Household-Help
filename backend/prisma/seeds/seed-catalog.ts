// prisma/seeds/seed-catalog.ts
//
// Prod-safe catalog bootstrap. Inserts ONLY reference data the app needs to
// function — service categories, their tasks, scope fields, and per-city
// pricing rules. No users, no bookings, no wipe. Fully idempotent: every
// write is an upsert / skip-if-exists, so re-running it is a no-op.
//
// AppSettings is deliberately NOT touched here — if the singleton row is
// missing, seed elsewhere or let the app create it.
//
// Run with: npx tsx prisma/seeds/seed-catalog.ts   (from the backend folder)

import "dotenv/config";
import { PrismaClient, ScopeFieldType } from "@prisma/client";
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
  minValue?: number;
  maxValue?: number;
  // Only meaningful for SELECT/MULTI_SELECT — turn on only where different
  // workers genuinely handle different options (see
  // ServiceScopeField.usedForMatching in schema.prisma).
  usedForMatching?: boolean;
};

const YES_NO = ["Yes", "No"];

const CATEGORIES: Array<{
  name: string;
  description: string;
  basePrice: number;
  icon: string;
  tasks: { name: string; description?: string; basePrice: number; durationHours: number }[];
  scopeFields: ScopeFieldSeed[];
}> = [
  {
    name: "Plumbing Repair",
    description: "Leak, clog, and fixture work priced by issue and severity",
    basePrice: 350,
    icon: "water-outline",
    tasks: [
      { name: "Leak Repair", description: "Locate and seal an active pipe or fixture leak.", basePrice: 350, durationHours: 1.5 },
      { name: "Drain & Clog Clearing", basePrice: 400, durationHours: 1 },
      { name: "Fixture Installation", basePrice: 500, durationHours: 2 },
      { name: "Water Heater Service", basePrice: 700, durationHours: 2.5 },
      { name: "Pipe Installation / Replacement", basePrice: 800, durationHours: 3 },
      { name: "Sewer / Septic Service", basePrice: 1500, durationHours: 4 },
    ],
    scopeFields: [
      {
        label: "Fixture Affected",
        fieldType: ScopeFieldType.SELECT,
        required: true,
        sortOrder: 0,
        options: ["Kitchen Sink", "Bathroom Sink", "Toilet", "Shower/Tub", "Water Heater", "Washing Machine Line", "Main Line", "Other"],
      },
      { label: "Active Leak Right Now?", fieldType: ScopeFieldType.SELECT, required: true, sortOrder: 1, options: YES_NO },
      { label: "Water Supply Shut Off?", fieldType: ScopeFieldType.SELECT, required: false, sortOrder: 2, options: YES_NO },
      { label: "Fixture Supplied By", fieldType: ScopeFieldType.SELECT, required: false, sortOrder: 3, options: ["Client Provides", "Technician Sources (parts cost added)"] },
      { label: "Pipe Material, If Known", fieldType: ScopeFieldType.SELECT, required: false, sortOrder: 4, options: ["Copper", "PVC", "Galvanized", "Not Sure"] },
    ],
  },
  {
    name: "Electrical Repair",
    description: "Wiring, fixture installs, and electrical troubleshooting",
    basePrice: 400,
    icon: "flash-outline",
    tasks: [
      { name: "Outlet / Switch Repair or Installation", basePrice: 300, durationHours: 1 },
      { name: "Circuit Breaker / Panel Repair", basePrice: 600, durationHours: 2 },
      { name: "Lighting Fixture Installation", basePrice: 450, durationHours: 1.5 },
      { name: "Panel Upgrade", basePrice: 2500, durationHours: 5 },
      { name: "Ceiling Fan Installation", basePrice: 500, durationHours: 1.5 },
    ],
    scopeFields: [
      {
        label: "Safety Check",
        fieldType: ScopeFieldType.MULTI_SELECT,
        required: true,
        sortOrder: 0,
        options: ["Burning Smell", "Sparking", "Exposed Wires", "Breaker Won't Reset", "None of These"],
      },
      { label: "Panel Type, If Known", fieldType: ScopeFieldType.SELECT, required: false, sortOrder: 1, options: ["Breaker Box", "Fuse Box", "Not Sure"] },
      { label: "Outlets/Fixtures Affected", fieldType: ScopeFieldType.NUMBER, required: false, sortOrder: 2, minValue: 1, maxValue: 20 },
      { label: "Area/Room", fieldType: ScopeFieldType.TEXT, required: true, sortOrder: 3 },
    ],
  },
  {
    name: "Home Appliance & Aircon Repair",
    description: "Diagnosis and repair for household appliances and aircon units",
    basePrice: 450,
    icon: "build-outline",
    tasks: [
      { name: "Washing Machine Repair", description: "Diagnose and fix a washing machine fault.", basePrice: 550, durationHours: 2 },
      { name: "Refrigerator Repair", basePrice: 500, durationHours: 2 },
      { name: "Oven/Stove Repair", basePrice: 500, durationHours: 2 },
      { name: "Dishwasher Repair", basePrice: 450, durationHours: 1.5 },
      { name: "General Appliance Diagnosis", basePrice: 300, durationHours: 1 },
    ],
    scopeFields: [
      {
        label: "Appliance Type",
        fieldType: ScopeFieldType.SELECT,
        required: true,
        sortOrder: 0,
        options: ["Washing Machine", "Dryer", "Refrigerator", "Oven/Stove", "Dishwasher", "Microwave", "Air Conditioner", "Other"],
        usedForMatching: true,
      },
      { label: "Brand", fieldType: ScopeFieldType.TEXT, required: false, sortOrder: 1 },
      { label: "Approximate Age", fieldType: ScopeFieldType.SELECT, required: false, sortOrder: 2, options: ["Under 2 Years", "2–5 Years", "Over 5 Years", "Not Sure"] },
      {
        label: "Symptom",
        fieldType: ScopeFieldType.SELECT,
        required: true,
        sortOrder: 3,
        options: ["Won't Turn On", "Leaking", "Not Heating or Cooling", "Unusual Noise", "Error Code Displayed", "Not Draining or Spinning", "Other"],
      },
      { label: "Error Code", fieldType: ScopeFieldType.TEXT, required: false, sortOrder: 4 },
      { label: "Aircon Unit Type (If Applicable)", fieldType: ScopeFieldType.SELECT, required: false, sortOrder: 5, options: ["Window Type", "Split Type", "Portable", "Not Sure"] },
      { label: "Number of Aircon Units (If Applicable)", fieldType: ScopeFieldType.NUMBER, required: false, sortOrder: 6, minValue: 1, maxValue: 10 },
    ],
  },
  {
    name: "Carpentry & Furniture Repair",
    description: "Furniture repair, custom builds, and woodwork",
    basePrice: 450,
    icon: "hammer-outline",
    tasks: [
      { name: "Furniture Repair", description: "Fix loose joints, hinges, or broken panels.", basePrice: 450, durationHours: 2 },
      { name: "Custom Shelving", basePrice: 1000, durationHours: 4 },
      { name: "Door & Window Framing", basePrice: 800, durationHours: 3 },
      { name: "Cabinet Installation", basePrice: 1200, durationHours: 4 },
      { name: "Furniture Assembly", basePrice: 350, durationHours: 1.5 },
    ],
    scopeFields: [
      { label: "Location", fieldType: ScopeFieldType.SELECT, required: true, sortOrder: 0, options: ["Indoor", "Outdoor"] },
      { label: "Materials Supplied By", fieldType: ScopeFieldType.SELECT, required: true, sortOrder: 1, options: ["Client Provides", "Carpenter Sources Materials"] },
      { label: "Approximate Dimensions", fieldType: ScopeFieldType.TEXT, required: false, sortOrder: 2 },
    ],
  },
  {
    name: "House Painting",
    description: "Interior and exterior painting services",
    basePrice: 600,
    icon: "color-palette-outline",
    tasks: [
      { name: "Interior Room Painting", description: "Prep, prime, and paint one room.", basePrice: 600, durationHours: 4 },
      { name: "Exterior Wall Painting", basePrice: 1500, durationHours: 8 },
      { name: "Touch-Up Painting", basePrice: 300, durationHours: 1.5 },
      { name: "Trim & Door Painting", basePrice: 400, durationHours: 2 },
    ],
    scopeFields: [
      { label: "Interior or Exterior", fieldType: ScopeFieldType.SELECT, required: true, sortOrder: 0, options: ["Interior", "Exterior"] },
      { label: "Surfaces to Paint", fieldType: ScopeFieldType.MULTI_SELECT, required: true, sortOrder: 1, options: ["Walls", "Ceiling", "Trim & Doors", "Full Room"] },
      { label: "Number of Rooms", fieldType: ScopeFieldType.NUMBER, required: true, sortOrder: 2, minValue: 1, maxValue: 20 },
      { label: "Wall Condition", fieldType: ScopeFieldType.SELECT, required: true, sortOrder: 3, options: ["Bare or Freshly Patched", "Previously Painted, Good Shape", "Needs Patching or Repair"] },
      { label: "Color Change", fieldType: ScopeFieldType.SELECT, required: true, sortOrder: 4, options: ["Similar Shade", "Going Lighter", "Going Darker or Bold Color"] },
      { label: "Paint Supplied By", fieldType: ScopeFieldType.SELECT, required: true, sortOrder: 5, options: ["Client Supplies", "Include in Service"] },
      { label: "Is the Room Furnished?", fieldType: ScopeFieldType.SELECT, required: false, sortOrder: 6, options: ["Furnished, Needs Moving", "Empty"] },
    ],
  },
  {
    name: "Pest Control",
    description: "Termite, rodent, and general pest treatment",
    basePrice: 700,
    icon: "bug-outline",
    tasks: [
      { name: "Termite Treatment", description: "Inspect and treat an active termite infestation.", basePrice: 1200, durationHours: 3 },
      { name: "Rodent Control", basePrice: 700, durationHours: 2 },
      { name: "General Pest Spraying", basePrice: 500, durationHours: 1.5 },
      { name: "Bed Bug Treatment", basePrice: 900, durationHours: 2.5 },
    ],
    scopeFields: [
      {
        label: "Pest Type",
        fieldType: ScopeFieldType.MULTI_SELECT,
        required: true,
        sortOrder: 0,
        options: ["Termites", "Rodents", "Cockroaches", "Ants", "Bed Bugs", "Mosquitoes", "Spiders", "Other"],
        usedForMatching: true,
      },
      { label: "Severity", fieldType: ScopeFieldType.SELECT, required: true, sortOrder: 1, options: ["A Few Sightings", "Regular Activity", "Visible Nest, Droppings, or Damage"] },
      { label: "Affected Areas", fieldType: ScopeFieldType.MULTI_SELECT, required: true, sortOrder: 2, options: ["Kitchen", "Bathroom", "Bedroom", "Attic or Crawlspace", "Yard or Exterior", "Whole Property"] },
      { label: "Pets or Children in Home?", fieldType: ScopeFieldType.SELECT, required: true, sortOrder: 3, options: YES_NO },
      { label: "Previously Treated?", fieldType: ScopeFieldType.SELECT, required: false, sortOrder: 4, options: ["Never", "Yes, Self-Treated", "Yes, Professionally, Recurred"] },
    ],
  },
  {
    name: "Home Cleaning",
    description: "Standard, deep, and move-in/move-out home cleaning",
    basePrice: 500,
    icon: "sparkles-outline",
    tasks: [
      { name: "Standard Cleaning", description: "Whole-home sweep, mop, dust, and surface wipe-down.", basePrice: 500, durationHours: 3 },
      { name: "Deep Cleaning", basePrice: 900, durationHours: 5 },
      { name: "Move-In / Move-Out Cleaning", basePrice: 1100, durationHours: 5.5 },
      { name: "Post-Construction Cleanup", basePrice: 1200, durationHours: 6 },
    ],
    scopeFields: [
      { label: "Clean Type", fieldType: ScopeFieldType.SELECT, required: true, sortOrder: 0, options: ["Standard Maintenance", "Deep Clean", "Move-In/Move-Out", "Post-Construction", "Post-Event"] },
      { label: "Bedrooms", fieldType: ScopeFieldType.NUMBER, required: true, sortOrder: 1, minValue: 0, maxValue: 10 },
      { label: "Bathrooms", fieldType: ScopeFieldType.NUMBER, required: true, sortOrder: 2, minValue: 0, maxValue: 10 },
      { label: "Additional Areas", fieldType: ScopeFieldType.MULTI_SELECT, required: false, sortOrder: 3, options: ["Kitchen", "Living Room", "Dining Room", "Home Office", "Garage", "Balcony"] },
      { label: "Last Professionally Cleaned", fieldType: ScopeFieldType.SELECT, required: true, sortOrder: 4, options: ["Within the Past Week", "A Few Weeks Ago", "A Month or More", "Never"] },
      { label: "Pets in the Home?", fieldType: ScopeFieldType.SELECT, required: false, sortOrder: 5, options: YES_NO },
    ],
  },
  {
    name: "Laundry & Ironing",
    description: "Wash, fold, and ironing service priced by load",
    basePrice: 150,
    icon: "shirt-outline",
    tasks: [
      { name: "Wash & Fold", basePrice: 150, durationHours: 1.5 },
      { name: "Wash & Iron", basePrice: 250, durationHours: 2.5 },
      { name: "Iron Only", basePrice: 120, durationHours: 1 },
      { name: "Dry-Clean Drop-off Coordination", basePrice: 100, durationHours: 0.5 },
    ],
    scopeFields: [
      { label: "Service Type", fieldType: ScopeFieldType.SELECT, required: true, sortOrder: 0, options: ["Wash & Fold", "Wash & Iron", "Iron Only", "Dry-Clean Drop-off Coordination"] },
      { label: "Estimated Load Size", fieldType: ScopeFieldType.SELECT, required: true, sortOrder: 1, options: ["Small (1-2 baskets)", "Medium (3-4 baskets)", "Large (5+ baskets)"] },
      { label: "Fabric Care Notes", fieldType: ScopeFieldType.TEXT, required: false, sortOrder: 2 },
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
          tasks: { create: cat.tasks },
          scopeFields: {
            create: cat.scopeFields.map((f) => ({
              label: f.label,
              fieldType: f.fieldType,
              required: f.required,
              sortOrder: f.sortOrder,
              minValue: f.minValue ?? null,
              maxValue: f.maxValue ?? null,
              usedForMatching: f.usedForMatching ?? false,
              options: f.options
                ? { create: f.options.map((label, idx) => ({ label, sortOrder: idx })) }
                : undefined,
            })),
          },
        },
      });
      createdTypes++;
      console.log(`  + ServiceType "${cat.name}" (${cat.tasks.length} tasks, ${cat.scopeFields.length} scope fields)`);
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
