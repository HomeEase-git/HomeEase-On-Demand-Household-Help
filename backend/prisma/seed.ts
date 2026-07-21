// prisma/seed.ts
//
// Run with: npx prisma db seed
// Requires: npm install -D @faker-js/faker   (bcrypt should already be a dependency)
//
// NOTE: Depending on your Prisma version, the `"prisma": { "seed": "..." }`
// config block may need to live in package.json OR in prisma.config.ts
// (you already hit this split with the `url` property in schema.prisma).
// Check whichever file currently holds your seed command config.

import "dotenv/config";
import {
  PrismaClient,
  Role,
  KYCStatus,
  KycDocumentType,
  KycDocumentStatus,
  ContractType,
  BookingStatus,
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
    KycDocumentType.CERTIFICATION,
    KycDocumentType.RESUME,
  ];

  for (const type of docTypes) {
    await prisma.kycDocument.create({
      data: {
        userId: user.id,
        documentType: type,
        fileUrl: `https://example-storage.dev/kyc/${user.id}/${type.toLowerCase()}.jpg`,
        status: docStatus,
        reviewedAt: isApproved ? faker.date.recent({ days: 10 }) : null,
      },
    });
  }

  await prisma.certification.create({
    data: {
      workerProfileId: user.workerProfile!.id,
      title: `${category.name} NC II`,
      issuer: "TESDA",
      issueDate: faker.date.past({ years: 3 }),
      documentUrl: `https://example-storage.dev/certifications/${user.id}.pdf`,
      verificationStatus: docStatus,
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
  const statuses: BookingStatus[] = [
    BookingStatus.PENDING,
    BookingStatus.ACCEPTED,
    BookingStatus.IN_PROGRESS,
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
  ];
  const timeSlots = ["09:00 AM", "01:00 PM", "03:30 PM", "05:00 PM"];

  for (let i = 0; i < 15; i++) {
    const client = faker.helpers.arrayElement(clients);
    const worker = faker.helpers.arrayElement(workers);
    const serviceType = faker.helpers.arrayElement(serviceTypes);
    const task = faker.helpers.arrayElement(serviceType.tasks);
    const status = faker.helpers.arrayElement(statuses);
    const estimatedPrice = task.basePrice;

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
          location: faker.location.streetAddress(),
          city: faker.helpers.arrayElement(CITIES),
        },
      });
    } catch {
      // Skip on rare worker/date/time collisions (worker_slot_unique constraint)
      continue;
    }

    if (status === BookingStatus.COMPLETED) {
      const subtotal = estimatedPrice;
      const commissionRate = 0.1;
      const withholdingTaxRate = 0.05;
      const commissionAmount = subtotal * commissionRate;
      const withholdingTaxAmount = subtotal * withholdingTaxRate;
      const workerPayout = subtotal - commissionAmount - withholdingTaxAmount;

      await prisma.payment.create({
        data: {
          bookingId: booking.id,
          subtotal,
          commissionRate,
          commissionAmount,
          withholdingTaxRate,
          withholdingTaxAmount,
          workerPayout,
          totalAmount: subtotal,
          status: PaymentStatus.COMPLETED,
          escrowStatus: EscrowStatus.RELEASED,
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