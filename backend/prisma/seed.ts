// prisma/seed.ts
//
// Run with: npx prisma db seed   (from the backend folder)
// Requires: @faker-js/faker, bcryptjs, @prisma/adapter-pg, pg

import "dotenv/config";
import {
  PrismaClient,
  Role,
  KYCStatus,
  KycDocumentType,
  KycDocumentStatus,
  ContractType,
  BookingStatus,
  QuoteStatus,
  PaymentStatus,
  EscrowStatus,
  PaymentMethodType,
} from "@prisma/client";
import { faker } from "@faker-js/faker";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DEFAULT_PASSWORD = "Password123!";
const NUM_CLIENTS = 10;
const WORKERS_PER_CATEGORY = 2;

const CITIES = [
  "Plaridel", "Malolos", "San Fernando", "Angeles City", "Quezon City",
  "Manila", "Makati", "Pasig", "Marikina", "Caloocan", "Taguig", "Bulacan",
];

const CATEGORIES = [
  {
    name: "Plumbing",
    description: "Pipe repairs, installations, and leak fixes",
    basePrice: 350,
    tasks: [
      { name: "Leak Repair", basePrice: 350, durationHours: 1.5 },
      { name: "Pipe Installation", basePrice: 800, durationHours: 3 },
      { name: "Drain Unclogging", basePrice: 400, durationHours: 1 },
    ],
  },
  {
    name: "Electrical",
    description: "Wiring, fixture installs, and electrical troubleshooting",
    basePrice: 400,
    tasks: [
      { name: "Outlet Installation", basePrice: 300, durationHours: 1 },
      { name: "Circuit Breaker Repair", basePrice: 600, durationHours: 2 },
      { name: "Lighting Fixture Setup", basePrice: 450, durationHours: 1.5 },
    ],
  },
  {
    name: "Cleaning",
    description: "Home and post-construction cleaning services",
    basePrice: 500,
    tasks: [
      { name: "General Home Cleaning", basePrice: 500, durationHours: 3 },
      { name: "Deep Cleaning", basePrice: 900, durationHours: 5 },
      { name: "Post-Construction Cleanup", basePrice: 1200, durationHours: 6 },
    ],
  },
  {
    name: "Carpentry",
    description: "Furniture repair, custom builds, and woodwork",
    basePrice: 450,
    tasks: [
      { name: "Furniture Repair", basePrice: 450, durationHours: 2 },
      { name: "Custom Shelving", basePrice: 1000, durationHours: 4 },
      { name: "Door/Window Framing", basePrice: 800, durationHours: 3 },
    ],
  },
  {
    name: "Aircon & Refrigeration",
    description: "AC cleaning, repair, and refrigerator servicing",
    basePrice: 500,
    tasks: [
      { name: "AC Cleaning", basePrice: 500, durationHours: 1.5 },
      { name: "AC Repair", basePrice: 900, durationHours: 2.5 },
      { name: "Refrigerator Repair", basePrice: 700, durationHours: 2 },
    ],
  },
  {
    name: "Painting",
    description: "Interior and exterior painting services",
    basePrice: 600,
    tasks: [
      { name: "Room Painting", basePrice: 600, durationHours: 4 },
      { name: "Exterior Wall Painting", basePrice: 1500, durationHours: 8 },
      { name: "Touch-Up Painting", basePrice: 300, durationHours: 1.5 },
    ],
  },
  {
    name: "Appliance Repair",
    description: "Washing machine, oven, and general appliance repair",
    basePrice: 450,
    tasks: [
      { name: "Washing Machine Repair", basePrice: 550, durationHours: 2 },
      { name: "Oven/Stove Repair", basePrice: 500, durationHours: 2 },
      { name: "General Appliance Diagnosis", basePrice: 300, durationHours: 1 },
    ],
  },
  {
    name: "Pest Control",
    description: "Termite, rodent, and general pest treatment",
    basePrice: 700,
    tasks: [
      { name: "Termite Treatment", basePrice: 1200, durationHours: 3 },
      { name: "Rodent Control", basePrice: 700, durationHours: 2 },
      { name: "General Pest Spraying", basePrice: 500, durationHours: 1.5 },
    ],
  },
];

const SKILL_POOL = [
  "Hand tools", "Power tools", "Customer service", "Blueprint reading",
  "Safety compliance", "Team supervision", "Inventory management",
];

function phoneNumber() {
  return "09" + faker.string.numeric(9);
}

async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

async function clearData() {
  await prisma.review.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.bookingAddOn.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.message.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.contractAcceptance.deleteMany();
  await prisma.resumeParseResult.deleteMany();
  await prisma.certification.deleteMany();
  await prisma.kycDocument.deleteMany();
  await prisma.verificationRequest.deleteMany();
  await prisma.savedPaymentMethod.deleteMany();
  await prisma.serviceTask.deleteMany();
  await prisma.authToken.deleteMany();
  await prisma.userAddress.deleteMany();
  await prisma.workerProfile.deleteMany();
  await prisma.clientProfile.deleteMany();
  await prisma.serviceType.deleteMany();
  await prisma.user.deleteMany();
}

async function createServiceTypes() {
  const created = [];
  for (const cat of CATEGORIES) {
    const serviceType = await prisma.serviceType.create({
      data: {
        name: cat.name,
        description: cat.description,
        basePrice: cat.basePrice,
        tasks: { create: cat.tasks },
      },
      include: { tasks: true },
    });
    created.push(serviceType);
  }
  return created;
}

async function createClient() {
  const fullName = faker.person.fullName();
  const email = faker.internet
    .email({ firstName: fullName.split(" ")[0], provider: "example.com" })
    .toLowerCase();
  const password = await hashPassword(DEFAULT_PASSWORD);
  const city = faker.helpers.arrayElement(CITIES);

  return prisma.user.create({
    data: {
      email,
      phone: phoneNumber(),
      password,
      fullName,
      role: Role.CLIENT,
      isVerified: true,
      avatar: faker.image.avatar(),
      clientProfile: {
        create: {
          address: faker.location.streetAddress(),
          city,
          state: "Philippines",
          zipCode: faker.location.zipCode("####"),
        },
      },
      addresses: {
        create: {
          label: "Home",
          street: faker.location.streetAddress(),
          city,
          state: "Philippines",
          zipCode: faker.location.zipCode("####"),
          isDefault: true,
        },
      },
    },
  });
}

async function createWorker(
  category: { id: string; name: string },
  kycOverride?: KYCStatus
) {
  const fullName = faker.person.fullName();
  const email = faker.internet
    .email({ firstName: fullName.split(" ")[0], provider: "example.com" })
    .toLowerCase();
  const password = await hashPassword(DEFAULT_PASSWORD);
  const city = faker.helpers.arrayElement(CITIES);
  const kycStatus = kycOverride ?? KYCStatus.APPROVED;
  const isApproved = kycStatus === KYCStatus.APPROVED;

  const user = await prisma.user.create({
    data: {
      email,
      phone: phoneNumber(),
      password,
      fullName,
      role: Role.WORKER,
      isVerified: true,
      avatar: faker.image.avatar(),
      addresses: {
        create: {
          label: "Home",
          street: faker.location.streetAddress(),
          city,
          state: "Philippines",
          zipCode: faker.location.zipCode("####"),
          isDefault: true,
        },
      },
      workerProfile: {
        create: {
          bio: faker.lorem.sentence(12),
          rating: faker.number.float({ min: 3.5, max: 5, fractionDigits: 1 }),
          totalReviews: faker.number.int({ min: 0, max: 40 }),
          isAvailable: true,
          maxConcurrentJobs: faker.helpers.arrayElement([1, 2, 3]),
          activeJobCount: 0,
          availableDays: [1, 2, 3, 4, 5],
          serviceAreaRadius: faker.helpers.arrayElement([15, 20, 30]),
          city,
          state: "Philippines",
          address: faker.location.streetAddress(),
          zipCode: faker.location.zipCode("####"),
          kycStatus,
          kycSubmittedAt: faker.date.recent({ days: 30 }),
          kycApprovedAt: isApproved ? faker.date.recent({ days: 15 }) : null,
          resumeUrl: "https://example-storage.dev/resumes/placeholder.pdf",
          serviceTypes: { connect: [{ id: category.id }] },
        },
      },
    },
    include: { workerProfile: true },
  });

  const docStatus = isApproved ? KycDocumentStatus.APPROVED : KycDocumentStatus.PENDING;
  const docTypes: KycDocumentType[] = [
    KycDocumentType.GOVERNMENT_ID_FRONT,
    KycDocumentType.GOVERNMENT_ID_BACK,
    KycDocumentType.SELFIE,
    KycDocumentType.RESUME,
    KycDocumentType.NBI_CLEARANCE,
  ];

  await prisma.verificationRequest.create({
    data: {
      userId: user.id,
      type: "WORKER_ONBOARDING",
      status: kycStatus,
      reviewedAt: isApproved ? faker.date.recent({ days: 10 }) : null,
      aiStatus: isApproved ? "MATCH" : null,
      aiConfidence: isApproved
        ? faker.number.float({ min: 0.85, max: 0.99, fractionDigits: 2 })
        : null,
      documents: {
        create: docTypes.map((type) => ({
          documentType: type,
          fileUrl: `https://example-storage.dev/kyc/${user.id}/${type.toLowerCase()}.jpg`,
          fileName: `${type.toLowerCase()}.jpg`,
          mimeType: "image/jpeg",
          status: docStatus,
          reviewedAt: isApproved ? faker.date.recent({ days: 10 }) : null,
        })),
      },
    },
  });

  await prisma.certification.create({
    data: {
      workerProfileId: user.workerProfile!.id,
      title: `${category.name} NC II`,
      issuer: "TESDA",
      issueDate: faker.date.past({ years: 3 }),
      documentUrl: `https://example-storage.dev/certifications/${user.id}.pdf`,
      verificationStatus: docStatus,
      reviewedAt: isApproved ? faker.date.recent({ days: 10 }) : null,
    },
  });

  await prisma.resumeParseResult.create({
    data: {
      workerProfileId: user.workerProfile!.id,
      rawText: faker.lorem.paragraphs(2),
      parsedSkills: [category.name, ...faker.helpers.arrayElements(SKILL_POOL, 2)],
      yearsOfExperience: faker.number.int({ min: 1, max: 15 }),
      masteryLevel: faker.helpers.arrayElement(["Beginner", "Intermediate", "Expert"]),
      tradeCategory: category.name,
      summary: faker.lorem.sentence(15),
    },
  });

  await prisma.contractAcceptance.create({
    data: {
      userId: user.id,
      contractType: ContractType.WORKER_SERVICE_AGREEMENT,
      contractVersion: "1.0",
    },
  });

  return user;
}

async function createBookingsAndPayments(
  clients: Awaited<ReturnType<typeof createClient>>[],
  workers: Awaited<ReturnType<typeof createWorker>>[],
  serviceTypes: Awaited<ReturnType<typeof createServiceTypes>>
) {
  // Every status gets at least one booking so every UI screen state has
  // something real to render, plus extra randomized ones on top.
  const allStatuses: BookingStatus[] = [
    BookingStatus.PENDING,
    BookingStatus.ACCEPTED,
    BookingStatus.REJECTED,
    BookingStatus.IN_PROGRESS,
    BookingStatus.QUOTE_SUBMITTED,
    BookingStatus.QUOTE_APPROVED,
    BookingStatus.DISPUTED,
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
  ];
  const extraRandomCount = 6;
  const statusQueue = [
    ...allStatuses,
    ...Array.from({ length: extraRandomCount }, () =>
      faker.helpers.arrayElement(allStatuses)
    ),
  ];
  const timeSlots = ["09:00 AM", "01:00 PM", "03:30 PM", "05:00 PM"];

  for (const status of statusQueue) {
    const client = faker.helpers.arrayElement(clients);
    const worker = faker.helpers.arrayElement(workers);
    const serviceType = faker.helpers.arrayElement(serviceTypes);
    const task = faker.helpers.arrayElement(serviceType.tasks);
    const estimatedPrice = task.basePrice;

    const isQuoteFlow =
      status === BookingStatus.QUOTE_SUBMITTED ||
      status === BookingStatus.QUOTE_APPROVED ||
      status === BookingStatus.DISPUTED;

    const laborCost = isQuoteFlow ? estimatedPrice * 0.6 : null;
    const materialsCost = isQuoteFlow ? estimatedPrice * 0.4 : null;

    let booking;
    try {
      booking = await prisma.booking.create({
        data: {
          clientId: client.id,
          workerId: worker.id,
          serviceType: serviceType.name,
          serviceTaskId: task.id,
          description: faker.lorem.sentence(10),
          estimatedDurationHours: task.durationHours,
          scheduledDate: faker.date.soon({ days: 14 }),
          scheduledTime: faker.helpers.arrayElement(timeSlots),
          status,
          estimatedPrice,
          tip: status === BookingStatus.COMPLETED
            ? faker.helpers.arrayElement([0, 50, 100])
            : 0,
          quoteStatus: isQuoteFlow
            ? status === BookingStatus.QUOTE_SUBMITTED
              ? QuoteStatus.SUBMITTED
              : status === BookingStatus.QUOTE_APPROVED
              ? QuoteStatus.APPROVED
              : QuoteStatus.DISPUTED
            : null,
          laborCost,
          materialsCost,
          quotedAt: isQuoteFlow ? faker.date.recent({ days: 5 }) : null,
          quoteNotes: isQuoteFlow ? faker.lorem.sentence(8) : null,
          approvedAt: status === BookingStatus.QUOTE_APPROVED ? faker.date.recent({ days: 2 }) : null,
          disputeReason: status === BookingStatus.DISPUTED ? faker.lorem.sentence(10) : null,
          finalPrice: status === BookingStatus.COMPLETED ? estimatedPrice : null,
          completionDate: status === BookingStatus.COMPLETED ? faker.date.recent({ days: 3 }) : null,
          location: faker.location.streetAddress(),
          city: faker.helpers.arrayElement(CITIES),
        },
      });
    } catch {
      // Skip rare worker/date/time collisions (worker_slot_unique constraint)
      continue;
    }

    if (status === BookingStatus.COMPLETED) {
      const subtotal = estimatedPrice;
      const tip = booking.tip ?? 0;
      const commissionRate = 0.1;
      const withholdingTaxRate = 0.05;
      const commissionAmount = subtotal * commissionRate;
      const withholdingTaxAmount = subtotal * withholdingTaxRate;
      const workerPayout = subtotal - commissionAmount - withholdingTaxAmount + tip;

      await prisma.payment.create({
        data: {
          bookingId: booking.id,
          subtotal,
          tip,
          commissionRate,
          commissionAmount,
          withholdingTaxRate,
          withholdingTaxAmount,
          workerPayout,
          totalAmount: subtotal + tip,
          status: PaymentStatus.COMPLETED,
          escrowStatus: EscrowStatus.RELEASED,
          releasedAt: faker.date.recent({ days: 2 }),
          methodType: PaymentMethodType.CASH,
        },
      });

      await prisma.review.create({
        data: {
          bookingId: booking.id,
          workerId: worker.workerProfile!.id,
          clientId: client.id,
          rating: faker.number.float({ min: 3, max: 5, fractionDigits: 1 }),
          comment: faker.lorem.sentence(8),
        },
      });
    }
  }
}

async function main() {
  console.log("Clearing existing data...");
  await clearData();

  console.log("Creating service categories...");
  const serviceTypes = await createServiceTypes();

  console.log(`Creating ${NUM_CLIENTS} clients...`);
  const clients = [];
  for (let i = 0; i < NUM_CLIENTS; i++) {
    clients.push(await createClient());
  }

  console.log(`Creating ${WORKERS_PER_CATEGORY} workers per category...`);
  const workers = [];
  for (const [catIndex, category] of serviceTypes.entries()) {
    for (let i = 0; i < WORKERS_PER_CATEGORY; i++) {
      // First category's second worker is left SUBMITTED/pending so the
      // admin KYC review queue has at least one real case to test.
      const kycOverride =
        catIndex === 0 && i === 1 ? KYCStatus.SUBMITTED : undefined;
      workers.push(await createWorker(category, kycOverride));
    }
  }

  console.log("Creating bookings, payments, and reviews...");
  await createBookingsAndPayments(clients, workers, serviceTypes);

  console.log(
    `Done. Seeded ${serviceTypes.length} categories, ${workers.length} workers, ${clients.length} clients.`
  );
  console.log(`All accounts use the password: ${DEFAULT_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });