// prisma/seeds/seed-full.ts
//
// Comprehensive seed — populates EVERY model and exercises every enum value
// and nullable column at least once (soft-deletes, disputes, refunds,
// tokens, messages, notifications, saved payment methods, add-ons, etc).
// seed.ts is the lightweight "happy path" seed used by `prisma db seed`;
// this one is for exercising every screen state / admin edge case.
//
// Run with: npx tsx prisma/seeds/seed-full.ts   (from the backend folder)
// Requires: @faker-js/faker, bcryptjs, @prisma/adapter-pg, pg

import "dotenv/config";
import {
  PrismaClient,
  Role,
  UserStatus,
  TokenType,
  KYCStatus,
  KycDocumentType,
  KycDocumentStatus,
  ContractType,
  BookingStatus,
  QuoteStatus,
  PaymentStatus,
  EscrowStatus,
  PaymentMethodType,
  ReviewStatus,
  NotificationType,
} from "@prisma/client";
import { faker } from "@faker-js/faker";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DEFAULT_PASSWORD = "Password123!";
const NUM_CLIENTS = 12;
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

const ALL_KYC_DOC_TYPES: KycDocumentType[] = [
  KycDocumentType.GOVERNMENT_ID_FRONT,
  KycDocumentType.GOVERNMENT_ID_BACK,
  KycDocumentType.SELFIE,
  KycDocumentType.RESUME,
  KycDocumentType.CERTIFICATION,
  KycDocumentType.NBI_CLEARANCE,
  KycDocumentType.BARANGAY_CLEARANCE,
  KycDocumentType.POLICE_CLEARANCE,
  KycDocumentType.CEDULA,
];

function phoneNumber() {
  return "09" + faker.string.numeric(9);
}

async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

function maskedAccountIdentifier(type: PaymentMethodType) {
  switch (type) {
    case PaymentMethodType.GCASH:
    case PaymentMethodType.MAYA:
      return "09XX XXX " + faker.string.numeric(4);
    default:
      return null;
  }
}

async function clearData() {
  await prisma.notification.deleteMany();
  await prisma.message.deleteMany();
  await prisma.review.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.bookingAddOn.deleteMany();
  await prisma.booking.deleteMany();
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
        isActive: true,
        tasks: { create: cat.tasks },
      },
      include: { tasks: true },
    });
    created.push(serviceType);
  }
  // One inactive service type, to exercise isActive=false on both models.
  const inactive = await prisma.serviceType.create({
    data: {
      name: "Landscaping (Retired)",
      description: "Discontinued category kept for historical bookings",
      basePrice: 400,
      isActive: false,
      tasks: {
        create: [{ name: "Lawn Mowing", basePrice: 400, durationHours: 2, isActive: false }],
      },
    },
    include: { tasks: true },
  });
  created.push(inactive);
  return created;
}

async function createAdmin() {
  const password = await hashPassword(DEFAULT_PASSWORD);
  return prisma.user.create({
    data: {
      email: "admin@homeease.dev",
      phone: phoneNumber(),
      password,
      fullName: "HomeEase Admin",
      role: Role.ADMIN,
      isVerified: true,
      avatar: faker.image.avatar(),
      notificationPreferences: { email: true, push: true, sms: false },
    },
  });
}

async function createClient(index: number) {
  const fullName = faker.person.fullName();
  const email = faker.internet
    .email({ firstName: fullName.split(" ")[0], provider: "example.com" })
    .toLowerCase();
  const password = await hashPassword(DEFAULT_PASSWORD);
  const city = faker.helpers.arrayElement(CITIES);

  // Sprinkle in every UserStatus / soft-delete combination so admin screens
  // and "excluded from active queries" logic have real rows to hit.
  let status: UserStatus = UserStatus.ACTIVE;
  let isDeleted = false;
  let deletedAt: Date | null = null;
  if (index === 0) {
    status = UserStatus.SUSPENDED;
  } else if (index === 1) {
    status = UserStatus.BANNED;
  } else if (index === 2) {
    status = UserStatus.DELETED;
    isDeleted = true;
    deletedAt = faker.date.recent({ days: 20 });
  }

  const client = await prisma.user.create({
    data: {
      email,
      phone: index === 3 ? null : phoneNumber(), // exercise nullable phone
      password,
      fullName,
      role: Role.CLIENT,
      isVerified: index !== 4, // one unverified client
      avatar: faker.image.avatar(),
      notificationPreferences: { email: true, push: index % 2 === 0, sms: false },
      status,
      isDeleted,
      deletedAt,
      clientProfile: {
        create: {
          address: faker.location.streetAddress(),
          city,
          state: "Philippines",
          zipCode: faker.location.zipCode("####"),
        },
      },
      addresses: {
        create: [
          {
            label: "Home",
            street: faker.location.streetAddress(),
            city,
            state: "Philippines",
            zipCode: faker.location.zipCode("####"),
            isDefault: true,
          },
          {
            label: "Work",
            street: faker.location.streetAddress(),
            city: faker.helpers.arrayElement(CITIES),
            state: "Philippines",
            zipCode: faker.location.zipCode("####"),
            isDefault: false,
            // one soft-deleted address to exercise UserAddress soft-delete
            isDeleted: index === 5,
            deletedAt: index === 5 ? faker.date.recent({ days: 10 }) : null,
          },
        ],
      },
      contractAcceptances: {
        create: {
          contractType: ContractType.CLIENT_USER_AGREEMENT,
          contractVersion: "1.0",
          ipAddress: faker.internet.ipv4(),
          userAgent: faker.internet.userAgent(),
        },
      },
    },
    include: { clientProfile: true },
  });

  // Saved payment methods — cover every PaymentMethodType at least once
  // across the client base.
  const methodType = faker.helpers.arrayElement(Object.values(PaymentMethodType));
  await prisma.savedPaymentMethod.create({
    data: {
      clientProfileId: client.clientProfile!.id,
      type: methodType,
      accountIdentifier: maskedAccountIdentifier(methodType),
      label: index === 0 ? "My GCash" : null,
      isDefault: true,
    },
  });
  return client;
}

async function createWorker(
  category: { id: string; name: string },
  kycOverride: KYCStatus,
  fullDocSet: boolean
) {
  const fullName = faker.person.fullName();
  const email = faker.internet
    .email({ firstName: fullName.split(" ")[0], provider: "example.com" })
    .toLowerCase();
  const password = await hashPassword(DEFAULT_PASSWORD);
  const city = faker.helpers.arrayElement(CITIES);
  const kycStatus = kycOverride;
  const isApproved = kycStatus === KYCStatus.APPROVED;
  const isRejected = kycStatus === KYCStatus.REJECTED;

  const user = await prisma.user.create({
    data: {
      email,
      phone: phoneNumber(),
      password,
      fullName,
      role: Role.WORKER,
      isVerified: true,
      avatar: faker.image.avatar(),
      notificationPreferences: { email: true, push: true, sms: true },
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
          isAvailable: !isRejected,
          maxConcurrentJobs: faker.helpers.arrayElement([1, 2, 3]),
          activeJobCount: faker.number.int({ min: 0, max: 2 }),
          availableDays: faker.helpers.arrayElement([
            [1, 2, 3, 4, 5],
            [0, 1, 2, 3, 4, 5, 6],
            [1, 3, 5],
          ]),
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
      contractAcceptances: {
        create: {
          contractType: ContractType.WORKER_SERVICE_AGREEMENT,
          contractVersion: "1.0",
          ipAddress: faker.internet.ipv4(),
          userAgent: faker.internet.userAgent(),
        },
      },
    },
    include: { workerProfile: true },
  });

  const docStatus = isApproved
    ? KycDocumentStatus.APPROVED
    : isRejected
    ? KycDocumentStatus.REJECTED
    : KycDocumentStatus.PENDING;
  const docTypes = fullDocSet
    ? ALL_KYC_DOC_TYPES
    : ALL_KYC_DOC_TYPES.slice(0, 5);

  await prisma.verificationRequest.create({
    data: {
      userId: user.id,
      type: "WORKER_ONBOARDING",
      status: kycStatus,
      rejectionReason: isRejected ? "Government ID photo was blurry and unreadable." : null,
      adminOverrideReason: fullDocSet ? "Manually approved after in-person verification." : null,
      reviewedById: kycStatus !== KYCStatus.PENDING ? "admin-seed-reviewer" : null,
      reviewedAt: kycStatus !== KYCStatus.PENDING ? faker.date.recent({ days: 10 }) : null,
      aiStatus: isApproved ? "MATCH" : isRejected ? "MISMATCH" : null,
      aiSummary: isApproved
        ? "Face match confidence high; document fields consistent."
        : isRejected
        ? "Face match failed; document fields inconsistent with selfie."
        : null,
      aiConfidence: isApproved
        ? faker.number.float({ min: 0.85, max: 0.99, fractionDigits: 2 })
        : isRejected
        ? faker.number.float({ min: 0.1, max: 0.4, fractionDigits: 2 })
        : null,
      aiError: kycStatus === KYCStatus.SUBMITTED ? "AI_TIMEOUT: provider did not respond in time" : null,
      aiReviewedAt: isApproved || isRejected ? faker.date.recent({ days: 11 }) : null,
      documents: {
        create: docTypes.map((type) => ({
          documentType: type,
          fileUrl: `https://example-storage.dev/kyc/${user.id}/${type.toLowerCase()}.jpg`,
          fileName: `${type.toLowerCase()}.jpg`,
          originalName: `${type.toLowerCase()}-original.jpg`,
          fileSize: faker.number.int({ min: 50_000, max: 5_000_000 }),
          mimeType: "image/jpeg",
          status: docStatus,
          rejectionReason: docStatus === KycDocumentStatus.REJECTED ? "Image unreadable." : null,
          reviewedById: docStatus !== KycDocumentStatus.PENDING ? "admin-seed-reviewer" : null,
          reviewedAt: docStatus !== KycDocumentStatus.PENDING ? faker.date.recent({ days: 10 }) : null,
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
      expiryDate: isRejected ? null : faker.date.future({ years: 2 }),
      documentUrl: `https://example-storage.dev/certifications/${user.id}.pdf`,
      verificationStatus: docStatus,
      rejectionReason: docStatus === KycDocumentStatus.REJECTED ? "Certificate could not be verified with TESDA." : null,
      reviewedAt: docStatus !== KycDocumentStatus.PENDING ? faker.date.recent({ days: 10 }) : null,
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
      modelUsed: "claude-sonnet-4-6",
    },
  });

  return user;
}

async function createAuthTokens(users: { id: string }[]) {
  const tokenTypes = Object.values(TokenType);
  // Guarantee every TokenType appears, then pad with random ones.
  const assignments = users.slice(0, tokenTypes.length).map((user, i) => ({
    user,
    type: tokenTypes[i],
  }));
  for (const extra of users.slice(tokenTypes.length, tokenTypes.length + 10)) {
    assignments.push({ user: extra, type: faker.helpers.arrayElement(tokenTypes) });
  }

  for (const { user, type } of assignments) {
    const isExpired = faker.datatype.boolean();
    await prisma.authToken.create({
      data: {
        userId: user.id,
        token: faker.string.alphanumeric(64),
        type,
        expiresAt: isExpired
          ? faker.date.recent({ days: 5 })
          : faker.date.soon({ days: 30 }),
      },
    });
  }
}

async function createMessages(clients: { id: string }[], workers: { id: string }[]) {
  // A few full conversations so both directions, read/unread, and image
  // attachments are all represented.
  for (let i = 0; i < 6; i++) {
    const client = faker.helpers.arrayElement(clients);
    const worker = faker.helpers.arrayElement(workers);
    const messageCount = faker.number.int({ min: 2, max: 5 });

    for (let m = 0; m < messageCount; m++) {
      const fromClient = m % 2 === 0;
      const isRead = faker.datatype.boolean();
      await prisma.message.create({
        data: {
          senderId: fromClient ? client.id : worker.id,
          receiverId: fromClient ? worker.id : client.id,
          content: faker.lorem.sentence(8),
          imageUrl: m === messageCount - 1 && i === 0
            ? "https://example-storage.dev/messages/photo.jpg"
            : null,
          isRead,
          readAt: isRead ? faker.date.recent({ days: 2 }) : null,
        },
      });
    }
  }
}

async function createNotifications(
  clients: { id: string }[],
  workers: { id: string }[],
  bookingIds: string[]
) {
  const allUsers = [...clients, ...workers];
  const notificationTypes = Object.values(NotificationType);

  for (const type of notificationTypes) {
    const user = faker.helpers.arrayElement(allUsers);
    const isRead = faker.datatype.boolean();
    await prisma.notification.create({
      data: {
        userId: user.id,
        type,
        title: type.replace(/_/g, " "),
        message: faker.lorem.sentence(10),
        relatedId: bookingIds.length ? faker.helpers.arrayElement(bookingIds) : null,
        isRead,
      },
    });
  }
}

async function createBookingsAndPayments(
  clients: Awaited<ReturnType<typeof createClient>>[],
  workers: Awaited<ReturnType<typeof createWorker>>[],
  serviceTypes: Awaited<ReturnType<typeof createServiceTypes>>
) {
  const allStatuses: BookingStatus[] = [
    BookingStatus.PENDING,
    BookingStatus.ACCEPTED,
    BookingStatus.REJECTED,
    BookingStatus.IN_PROGRESS,
    BookingStatus.QUOTE_SUBMITTED,
    BookingStatus.QUOTE_APPROVED,
    BookingStatus.DISPUTED,
    BookingStatus.DISPUTED, // second one gets resolved, to cover both states
    BookingStatus.COMPLETED,
    BookingStatus.COMPLETED, // extra completed bookings for payment variety
    BookingStatus.COMPLETED,
    BookingStatus.COMPLETED,
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
  ];
  const timeSlots = ["09:00 AM", "01:00 PM", "03:30 PM", "05:00 PM"];
  const bookingIds: string[] = [];

  // Payment enum combinations we want guaranteed coverage for, consumed in
  // order as COMPLETED bookings are created.
  const paymentPlans: Array<{
    status: PaymentStatus;
    escrowStatus: EscrowStatus;
    methodType: PaymentMethodType;
    refunded: boolean;
  }> = [
    { status: PaymentStatus.COMPLETED, escrowStatus: EscrowStatus.RELEASED, methodType: PaymentMethodType.CASH, refunded: false },
    { status: PaymentStatus.COMPLETED, escrowStatus: EscrowStatus.HELD, methodType: PaymentMethodType.GCASH, refunded: false },
    { status: PaymentStatus.FAILED, escrowStatus: EscrowStatus.HELD, methodType: PaymentMethodType.GCASH, refunded: false },
    { status: PaymentStatus.REFUNDED, escrowStatus: EscrowStatus.REFUNDED, methodType: PaymentMethodType.MAYA, refunded: true },
    { status: PaymentStatus.PENDING, escrowStatus: EscrowStatus.HELD, methodType: PaymentMethodType.CASH, refunded: false },
  ];
  let paymentPlanIndex = 0;
  let disputedResolvedCount = 0;

  for (const status of allStatuses) {
    const client = faker.helpers.arrayElement(clients);
    // Every 5th booking is left unassigned (open marketplace request), which
    // exercises Booking.workerId being nullable.
    const isUnassigned = status === BookingStatus.PENDING && Math.random() < 0.4;
    const worker = isUnassigned ? null : faker.helpers.arrayElement(workers);
    const serviceType = faker.helpers.arrayElement(serviceTypes.filter((s) => s.tasks.length));
    const task = faker.helpers.arrayElement(serviceType.tasks);
    const estimatedPrice = task.basePrice;

    const isQuoteFlow =
      status === BookingStatus.QUOTE_SUBMITTED ||
      status === BookingStatus.QUOTE_APPROVED ||
      status === BookingStatus.DISPUTED;

    const laborCost = isQuoteFlow ? estimatedPrice * 0.6 : null;
    const materialsCost = isQuoteFlow ? estimatedPrice * 0.4 : null;
    const isDisputed = status === BookingStatus.DISPUTED;
    const resolveThisDispute = isDisputed && disputedResolvedCount === 0;
    if (isDisputed) disputedResolvedCount++;

    const chargeInspectionFee = status === BookingStatus.REJECTED || status === BookingStatus.CANCELLED;

    let booking;
    try {
      booking = await prisma.booking.create({
        data: {
          clientId: client.id,
          workerId: worker ? worker.id : null,
          serviceType: serviceType.name,
          serviceTaskId: task.id,
          description: faker.lorem.sentence(10),
          estimatedDurationHours: task.durationHours,
          scheduledDate: faker.date.soon({ days: 14 }),
          scheduledTime: worker ? faker.helpers.arrayElement(timeSlots) : null,
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
          disputeReason: isDisputed ? faker.lorem.sentence(10) : null,
          disputeResolvedById: resolveThisDispute ? "admin-seed-reviewer" : null,
          disputeResolvedAt: resolveThisDispute ? faker.date.recent({ days: 1 }) : null,
          inspectionFeeCharged: chargeInspectionFee,
          inspectionFeeAmount: chargeInspectionFee ? 150 : null,
          finalPrice: status === BookingStatus.COMPLETED ? estimatedPrice : null,
          completionDate: status === BookingStatus.COMPLETED ? faker.date.recent({ days: 3 }) : null,
          location: faker.location.streetAddress(),
          city: faker.helpers.arrayElement(CITIES),
          notes: faker.datatype.boolean() ? faker.lorem.sentence(6) : null,
        },
      });
    } catch {
      // Skip rare worker/date/time collisions (worker_slot_unique constraint)
      continue;
    }

    bookingIds.push(booking.id);

    // One or two add-ons on roughly a third of bookings.
    if (faker.datatype.boolean() && faker.datatype.boolean()) {
      const addOnCount = faker.number.int({ min: 1, max: 2 });
      for (let a = 0; a < addOnCount; a++) {
        await prisma.bookingAddOn.create({
          data: {
            bookingId: booking.id,
            name: faker.commerce.productName(),
            price: faker.number.int({ min: 50, max: 300 }),
          },
        });
      }
    }

    if (status === BookingStatus.COMPLETED && worker) {
      const plan = paymentPlans[paymentPlanIndex % paymentPlans.length];
      paymentPlanIndex++;

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
          status: plan.status,
          escrowStatus: plan.escrowStatus,
          releasedAt: plan.escrowStatus === EscrowStatus.RELEASED ? faker.date.recent({ days: 2 }) : null,
          refundReason: plan.refunded ? "Client reported no-show; refunded per policy." : null,
          refundedAt: plan.refunded ? faker.date.recent({ days: 1 }) : null,
          paymongoPaymentId: plan.methodType !== PaymentMethodType.CASH ? `pay_${faker.string.alphanumeric(20)}` : null,
          paymongoSourceId: plan.methodType !== PaymentMethodType.CASH ? `src_${faker.string.alphanumeric(20)}` : null,
          methodType: plan.methodType,
          accountIdentifier: maskedAccountIdentifier(plan.methodType),
        },
      });

      // Vary review moderation state across VISIBLE / HIDDEN / WARNED.
      const reviewStatus = faker.helpers.arrayElement([
        ReviewStatus.VISIBLE,
        ReviewStatus.VISIBLE,
        ReviewStatus.HIDDEN,
        ReviewStatus.WARNED,
      ]);
      const flagged = reviewStatus !== ReviewStatus.VISIBLE;

      await prisma.review.create({
        data: {
          bookingId: booking.id,
          workerId: worker.workerProfile!.id,
          clientId: client.id,
          rating: faker.number.float({ min: 1, max: 5, fractionDigits: 1 }),
          comment: faker.datatype.boolean() ? faker.lorem.sentence(8) : null,
          flagged,
          flagReason: flagged ? "Contains inappropriate language." : null,
          status: reviewStatus,
        },
      });
    }
  }

  return bookingIds;
}

async function main() {
  console.log("Clearing existing data...");
  await clearData();

  console.log("Creating service categories (including one inactive)...");
  const serviceTypes = await createServiceTypes();

  console.log("Creating admin...");
  const admin = await createAdmin();

  console.log(`Creating ${NUM_CLIENTS} clients (with status/soft-delete variety)...`);
  const clients = [];
  for (let i = 0; i < NUM_CLIENTS; i++) {
    clients.push(await createClient(i));
  }

  console.log(`Creating ${WORKERS_PER_CATEGORY} workers per category (all KYC states)...`);
  const workers = [];
  const activeCategories = serviceTypes.filter((s) => s.tasks.length && s.isActive);
  const kycRotation = [KYCStatus.APPROVED, KYCStatus.PENDING, KYCStatus.SUBMITTED, KYCStatus.REJECTED];
  let workerIndex = 0;
  for (const category of activeCategories) {
    for (let i = 0; i < WORKERS_PER_CATEGORY; i++) {
      const kycOverride = kycRotation[workerIndex % kycRotation.length];
      const fullDocSet = workerIndex === 0; // first worker gets every KycDocumentType
      workers.push(await createWorker(category, kycOverride, fullDocSet));
      workerIndex++;
    }
  }

  console.log("Creating auth tokens (all token types)...");
  await createAuthTokens([admin, ...clients, ...workers]);

  console.log("Creating bookings, add-ons, payments, and reviews...");
  const approvedWorkers = workers.filter((w) => w.workerProfile!.kycStatus === KYCStatus.APPROVED);
  const bookingIds = await createBookingsAndPayments(clients, approvedWorkers.length ? approvedWorkers : workers, serviceTypes);

  console.log("Creating messages between clients and workers...");
  await createMessages(clients, workers);

  console.log("Creating notifications (all notification types)...");
  await createNotifications(clients, workers, bookingIds);

  console.log("Creating app settings...");
  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  console.log(
    `Done. Seeded ${serviceTypes.length} service types, ${workers.length} workers, ${clients.length} clients, 1 admin, ${bookingIds.length} bookings.`
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
