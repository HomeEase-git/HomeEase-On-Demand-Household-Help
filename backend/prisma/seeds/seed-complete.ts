// prisma/seeds/seed-complete.ts
//
// The "everything" seed — every model in schema.prisma gets rows, and every
// nullable/optional column gets a real value on at least one row (soft
// deletes, disputes, refunds, payouts, worker packages, scope fields,
// pricing rules, audit logs, the works). seed-full.ts covers the common
// screen states; this one exists to exercise admin tooling and reports that
// read from tables seed-full.ts never touches (Payout, PricingRule,
// AuditLog, WorkerAvailability, Skill, WorkerPackage, ServiceScopeField,
// DeclinedWorker, ArrivalVerification, Cancellation, PricingLog, Dispute).
//
// Run with: npx tsx prisma/seeds/seed-complete.ts   (from the backend folder)
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
  PayoutStatus,
  ReviewStatus,
  NotificationType,
  RoomType,
  ConditionType,
  TimeSlot,
  ScopeFieldType,
  ServiceScopeType,
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

const ROOM_TYPES: RoomType[] = [
  RoomType.BEDROOM, RoomType.BATHROOM, RoomType.KITCHEN, RoomType.LIVING_ROOM,
  RoomType.DINING_ROOM, RoomType.OFFICE, RoomType.GARAGE, RoomType.BALCONY, RoomType.OTHER,
];

const CONDITION_TYPES: ConditionType[] = [ConditionType.TIDY, ConditionType.NORMAL, ConditionType.HEAVY];

const PRIORITY_POOL = [
  "Fragile items in the area", "Has pets on-site", "Allergic to strong chemicals",
  "Prefers eco-friendly products", "Needs same-day service", "Elderly household member",
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
  tasks: { name: string; basePrice: number; durationHours: number }[];
  scopeType?: ServiceScopeType;
  hasCondition?: boolean;
  scopeFields?: ScopeFieldSeed[];
}> = [
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
    scopeType: ServiceScopeType.CUSTOM,
    hasCondition: false,
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
    tasks: [
      { name: "Termite Treatment", basePrice: 1200, durationHours: 3 },
      { name: "Rodent Control", basePrice: 700, durationHours: 2 },
      { name: "General Pest Spraying", basePrice: 500, durationHours: 1.5 },
    ],
    scopeType: ServiceScopeType.CUSTOM,
    hasCondition: true,
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

const PAYOUT_CHANNELS: PaymentMethodType[] = [
  PaymentMethodType.GCASH,
  PaymentMethodType.MAYA,
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

// Rough bounding box covering Metro Manila / Bulacan / Pampanga, matching CITIES.
function randomLatLng() {
  return {
    lat: faker.number.float({ min: 14.4, max: 15.2, fractionDigits: 6 }),
    lng: faker.number.float({ min: 120.6, max: 121.1, fractionDigits: 6 }),
  };
}

async function clearData() {
  // Children before parents.
  await prisma.payout.deleteMany();
  await prisma.pricingLog.deleteMany();
  await prisma.dispute.deleteMany();
  await prisma.cancellation.deleteMany();
  await prisma.arrivalVerification.deleteMany();
  await prisma.declinedWorker.deleteMany();
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
  await prisma.workerAvailability.deleteMany();
  await prisma.skill.deleteMany();
  await prisma.workerPackage.deleteMany();
  await prisma.serviceTask.deleteMany();
  await prisma.serviceScopeFieldOption.deleteMany();
  await prisma.serviceScopeField.deleteMany();
  await prisma.authToken.deleteMany();
  await prisma.userAddress.deleteMany();
  await prisma.workerProfile.deleteMany();
  await prisma.clientProfile.deleteMany();
  await prisma.serviceType.deleteMany();
  await prisma.user.deleteMany();
  await prisma.pricingRule.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.appSettings.deleteMany();
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
                  ? { create: f.options.map((label, i) => ({ label, sortOrder: i })) }
                  : undefined,
              })),
            }
          : undefined,
      },
      include: { tasks: true, scopeFields: { include: { options: true } } },
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
    include: { tasks: true, scopeFields: { include: { options: true } } },
  });
  created.push(inactive);
  return created;
}

async function createPricingRules(serviceTypes: Awaited<ReturnType<typeof createServiceTypes>>) {
  for (const st of serviceTypes) {
    if (!st.isActive) continue;
    const cities = faker.helpers.arrayElements(CITIES, 3);
    for (const city of cities) {
      await prisma.pricingRule.create({
        data: {
          city,
          serviceType: st.name,
          minPrice: Math.round(st.basePrice * 0.8),
          maxPrice: Math.round(st.basePrice * 1.6),
        },
      });
    }
  }
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
  fullDocSet: boolean,
  workerIndex: number
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
  const { lat, lng } = randomLatLng();
  const payoutMethod = faker.helpers.arrayElement(PAYOUT_CHANNELS);

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
          digitalIdTrade: category.name,
          digitalIdServiceArea: `${city} and nearby areas`,
          licenseNumber: `LIC-${faker.string.alphanumeric(8).toUpperCase()}`,
          isAvailable: !isRejected,
          maxConcurrentJobs: faker.helpers.arrayElement([1, 2, 3]),
          activeJobCount: faker.number.int({ min: 0, max: 2 }),
          availableDays: faker.helpers.arrayElement([
            [1, 2, 3, 4, 5],
            [0, 1, 2, 3, 4, 5, 6],
            [1, 3, 5],
          ]),
          serviceAreaRadius: faker.helpers.arrayElement([15, 20, 30]),
          acceptsHeavyCondition: workerIndex % 2 === 0,
          acceptsPets: workerIndex % 3 !== 0,
          preferredRoomTypes: faker.helpers.arrayElements(ROOM_TYPES, { min: 1, max: 3 }),
          hourlyRate: faker.number.float({ min: 150, max: 600, fractionDigits: 2 }),
          city,
          state: "Philippines",
          address: faker.location.streetAddress(),
          zipCode: faker.location.zipCode("####"),
          currentLat: isRejected ? null : lat,
          currentLng: isRejected ? null : lng,
          lastLocationUpdate: isRejected ? null : faker.date.recent({ days: 1 }),
          kycStatus,
          kycSubmittedAt: faker.date.recent({ days: 30 }),
          kycApprovedAt: isApproved ? faker.date.recent({ days: 15 }) : null,
          resumeUrl: "https://example-storage.dev/resumes/placeholder.pdf",
          payoutMethod,
          payoutAccountName: fullName,
          payoutAccountNumber: phoneNumber(),
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
  const docTypes = fullDocSet ? ALL_KYC_DOC_TYPES : ALL_KYC_DOC_TYPES.slice(0, 5);

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

  // Skills — a couple of named, priced skills per worker.
  const skillNames = faker.helpers.arrayElements(SKILL_POOL, { min: 2, max: 3 });
  for (const name of skillNames) {
    await prisma.skill.create({
      data: {
        workerProfileId: user.workerProfile!.id,
        name,
        category: category.name,
        rate: faker.number.float({ min: 100, max: 500, fractionDigits: 2 }),
      },
    });
  }

  // Availability — a mix of open, blocked, and booked slots over the next few days.
  const slotCycle: TimeSlot[] = [TimeSlot.MORNING, TimeSlot.AFTERNOON, TimeSlot.EVENING];
  for (let d = 1; d <= 5; d++) {
    const date = new Date();
    date.setDate(date.getDate() + d);
    date.setHours(0, 0, 0, 0);
    await prisma.workerAvailability.create({
      data: {
        workerProfileId: user.workerProfile!.id,
        date,
        timeSlot: slotCycle[d % slotCycle.length],
        isBlocked: d === 2,
        isBooked: d === 4,
      },
    });
  }

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
        expiresAt: isExpired ? faker.date.recent({ days: 5 }) : faker.date.soon({ days: 30 }),
      },
    });
  }
}

async function createMessages(clients: { id: string }[], workers: { id: string }[]) {
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
          imageUrl:
            m === messageCount - 1 && i === 0 ? "https://example-storage.dev/messages/photo.jpg" : null,
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

async function createAuditLogs(admin: { id: string; fullName: string }) {
  const entries: Array<{
    actorId: string | null;
    actorName: string | null;
    actorRole: string | null;
    action: string;
    category: string;
    level: string;
    message: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: any;
  }> = [
    {
      actorId: admin.id,
      actorName: admin.fullName,
      actorRole: "ADMIN",
      action: "USER_LOGIN_SUCCESS",
      category: "LOGIN",
      level: "INFO",
      message: `${admin.fullName} logged in`,
      metadata: { ip: faker.internet.ipv4() },
    },
    {
      actorId: admin.id,
      actorName: admin.fullName,
      actorRole: "ADMIN",
      action: "BOOKING_DECLINED",
      category: "ADMIN_ACTION",
      level: "INFO",
      message: "Admin manually declined a booking on behalf of a suspended worker.",
      metadata: { bookingId: faker.string.alphanumeric(24) },
    },
    {
      actorId: admin.id,
      actorName: admin.fullName,
      actorRole: "ADMIN",
      action: "DISPUTE_RESOLVED",
      category: "ADMIN_ACTION",
      level: "INFO",
      message: "Admin resolved a client dispute with a partial refund.",
      metadata: { refundAmount: 250 },
    },
    {
      actorId: admin.id,
      actorName: admin.fullName,
      actorRole: "ADMIN",
      action: "PLATFORM_CONFIG_UPDATED",
      category: "ADMIN_ACTION",
      level: "WARN",
      message: "Commission rate changed from 10% to 12%.",
      metadata: { field: "commissionRate", from: 0.1, to: 0.12 },
    },
    {
      actorId: null,
      actorName: null,
      actorRole: null,
      action: "PAYOUT_TRANSFER_FAILED",
      category: "SYSTEM_ERROR",
      level: "ERROR",
      message: "PayMongo transfer failed: insufficient platform balance.",
      metadata: { errorCode: "INSUFFICIENT_BALANCE" },
    },
    {
      actorId: null,
      actorName: "System",
      actorRole: null,
      action: "BOOKING_AUTO_EXPIRED",
      category: "STATUS_CHANGE",
      level: "INFO",
      message: "Unassigned booking expired after no worker match was found in time.",
      metadata: undefined,
    },
    {
      actorId: admin.id,
      actorName: admin.fullName,
      actorRole: "ADMIN",
      action: "USER_SUSPENDED",
      category: "ADMIN_ACTION",
      level: "WARN",
      message: "Admin suspended a client account for repeated no-shows.",
      metadata: { reason: "repeated_no_show" },
    },
  ];

  for (const entry of entries) {
    await prisma.auditLog.create({ data: entry });
  }
}

async function createBookingsAndPayments(
  clients: Awaited<ReturnType<typeof createClient>>[],
  workers: Awaited<ReturnType<typeof createWorker>>[],
  allWorkers: Awaited<ReturnType<typeof createWorker>>[],
  serviceTypes: Awaited<ReturnType<typeof createServiceTypes>>,
  admin: { id: string }
) {
  const timeSlotLabels: Array<{ label: string; slot: TimeSlot }> = [
    { label: "09:00 AM", slot: TimeSlot.MORNING },
    { label: "01:00 PM", slot: TimeSlot.AFTERNOON },
    { label: "03:30 PM", slot: TimeSlot.AFTERNOON },
    { label: "06:00 PM", slot: TimeSlot.EVENING },
  ];

  type Scenario = {
    status: BookingStatus;
    unassigned?: boolean;
    isAutoMatched?: boolean;
    disputeStatus?: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "REJECTED";
    payoutStatus?: PayoutStatus;
    legacyXendit?: boolean;
    paymentStatusOverride?: PaymentStatus;
    cancelledBy?: Role;
    noTask?: boolean;
  };

  const scenarios: Scenario[] = [
    { status: BookingStatus.PENDING, unassigned: true, isAutoMatched: true },
    { status: BookingStatus.PENDING, noTask: true },
    { status: BookingStatus.ACCEPTED },
    { status: BookingStatus.REJECTED },
    { status: BookingStatus.IN_PROGRESS },
    { status: BookingStatus.QUOTE_SUBMITTED },
    { status: BookingStatus.QUOTE_APPROVED },
    { status: BookingStatus.PENDING_COMPLETION },
    { status: BookingStatus.DISPUTED, disputeStatus: "OPEN" },
    { status: BookingStatus.DISPUTED, disputeStatus: "UNDER_REVIEW" },
    { status: BookingStatus.DISPUTED, disputeStatus: "RESOLVED" },
    { status: BookingStatus.DISPUTED, disputeStatus: "REJECTED" },
    { status: BookingStatus.COMPLETED, payoutStatus: PayoutStatus.PENDING, isAutoMatched: true },
    { status: BookingStatus.COMPLETED, payoutStatus: PayoutStatus.PROCESSING },
    { status: BookingStatus.COMPLETED, payoutStatus: PayoutStatus.PAID },
    { status: BookingStatus.COMPLETED, payoutStatus: PayoutStatus.FAILED, legacyXendit: true },
    { status: BookingStatus.COMPLETED, paymentStatusOverride: PaymentStatus.FAILED },
    { status: BookingStatus.COMPLETED, paymentStatusOverride: PaymentStatus.REFUNDED },
    { status: BookingStatus.COMPLETED, paymentStatusOverride: PaymentStatus.PENDING },
    { status: BookingStatus.CANCELLED, cancelledBy: Role.CLIENT },
    { status: BookingStatus.CANCELLED, cancelledBy: Role.WORKER },
    { status: BookingStatus.CANCELLED, cancelledBy: Role.ADMIN },
  ];

  const bookingIds: string[] = [];
  const arrivalStatuses = new Set<BookingStatus>([
    BookingStatus.IN_PROGRESS,
    BookingStatus.QUOTE_SUBMITTED,
    BookingStatus.QUOTE_APPROVED,
    BookingStatus.PENDING_COMPLETION,
    BookingStatus.DISPUTED,
    BookingStatus.COMPLETED,
  ]);
  const paymentEligibleStatuses = new Set<BookingStatus>([
    BookingStatus.ACCEPTED,
    BookingStatus.IN_PROGRESS,
    BookingStatus.QUOTE_SUBMITTED,
    BookingStatus.QUOTE_APPROVED,
    BookingStatus.PENDING_COMPLETION,
    BookingStatus.DISPUTED,
    BookingStatus.COMPLETED,
  ]);

  for (const [index, scenario] of scenarios.entries()) {
    const { status } = scenario;
    const client = faker.helpers.arrayElement(clients);
    const worker = scenario.unassigned ? null : faker.helpers.arrayElement(workers);
    const serviceType = faker.helpers.arrayElement(serviceTypes.filter((s) => s.tasks.length));
    const task = scenario.noTask ? null : faker.helpers.arrayElement(serviceType.tasks);
    const estimatedPrice = task ? task.basePrice : serviceType.basePrice;
    const isCustomScope = serviceType.scopeType === ServiceScopeType.CUSTOM;

    const clientLoc = randomLatLng();
    const workerLoc = randomLatLng();
    const hasArrived = worker && arrivalStatuses.has(status);
    const distanceMeters = hasArrived ? faker.number.int({ min: 15, max: 3000 }) : null;

    const isQuoteFlow =
      status === BookingStatus.QUOTE_SUBMITTED ||
      status === BookingStatus.QUOTE_APPROVED ||
      status === BookingStatus.DISPUTED;
    const laborCost = isQuoteFlow ? estimatedPrice * 0.6 : null;
    const materialsCost = isQuoteFlow ? estimatedPrice * 0.4 : null;
    const isDisputed = status === BookingStatus.DISPUTED;
    const disputeResolved = isDisputed && (scenario.disputeStatus === "RESOLVED" || scenario.disputeStatus === "REJECTED");

    const chargeInspectionFee = status === BookingStatus.REJECTED || status === BookingStatus.CANCELLED;
    const timeSlotChoice = worker ? faker.helpers.arrayElement(timeSlotLabels) : null;
    const paymentMethodType = worker ? faker.helpers.arrayElement(Object.values(PaymentMethodType)) : null;

    const declinedPool = allWorkers.filter((w) => w.id !== worker?.id).slice(0, 3);
    const declinedIds = scenario.isAutoMatched
      ? faker.helpers.arrayElements(declinedPool, { min: 1, max: 2 }).map((w) => w.id)
      : [];

    const rooms = !isCustomScope ? faker.helpers.arrayElements(ROOM_TYPES, { min: 1, max: 3 }) : [];
    const condition = !isCustomScope ? faker.helpers.arrayElement(CONDITION_TYPES) : null;
    const scopeAnswers = isCustomScope
      ? Object.fromEntries(
          serviceType.scopeFields.map((f: { label: string; fieldType: ScopeFieldType; options: { label: string }[] }) =>
            f.fieldType === ScopeFieldType.MULTI_SELECT
              ? [f.label, faker.helpers.arrayElements(f.options.map((o) => o.label), { min: 1, max: 2 })]
              : f.fieldType === ScopeFieldType.SELECT
              ? [f.label, faker.helpers.arrayElement(f.options.map((o) => o.label))]
              : [f.label, faker.lorem.sentence(6)]
          )
        )
      : null;
    const priorities = faker.helpers.arrayElements(PRIORITY_POOL, { min: 0, max: 2 });

    const isCompletedLike = status === BookingStatus.COMPLETED || status === BookingStatus.PENDING_COMPLETION;

    let booking;
    try {
      booking = await prisma.booking.create({
        data: {
          clientId: client.id,
          workerId: worker ? worker.id : null,
          isAutoMatched: !!scenario.isAutoMatched,
          declinedWorkerIds: declinedIds,
          expiresAt: scenario.unassigned ? faker.date.soon({ days: 1 }) : null,
          serviceType: serviceType.name,
          serviceTaskId: task ? task.id : null,
          description: faker.lorem.sentence(10),
          estimatedDurationHours: task ? task.durationHours : null,
          rooms,
          condition,
          priorities,
          scopeAnswers: scopeAnswers ?? undefined,
          scheduledDate: faker.date.soon({ days: 14 }),
          scheduledTime: timeSlotChoice?.label ?? null,
          timeSlot: timeSlotChoice?.slot ?? null,
          status,
          estimatedPrice,
          tip: status === BookingStatus.COMPLETED ? faker.helpers.arrayElement([0, 50, 100]) : 0,
          quoteStatus: isQuoteFlow
            ? status === BookingStatus.QUOTE_SUBMITTED
              ? QuoteStatus.SUBMITTED
              : status === BookingStatus.QUOTE_APPROVED
              ? QuoteStatus.APPROVED
              : QuoteStatus.DISPUTED
            : status === BookingStatus.IN_PROGRESS
            ? QuoteStatus.PENDING
            : null,
          laborCost,
          materialsCost,
          quotedAt: isQuoteFlow ? faker.date.recent({ days: 5 }) : null,
          quoteNotes: isQuoteFlow ? faker.lorem.sentence(8) : null,
          approvedAt: status === BookingStatus.QUOTE_APPROVED ? faker.date.recent({ days: 2 }) : null,
          disputeReason: isDisputed ? faker.lorem.sentence(10) : null,
          disputeResolvedById: disputeResolved ? admin.id : null,
          disputeResolvedAt: disputeResolved ? faker.date.recent({ days: 1 }) : null,
          inspectionFeeCharged: chargeInspectionFee,
          inspectionFeeAmount: chargeInspectionFee ? 150 : null,
          finalPrice: status === BookingStatus.COMPLETED ? estimatedPrice : null,
          completionPhotoUrl: isCompletedLike
            ? `https://example-storage.dev/completions/${faker.string.uuid()}.jpg`
            : null,
          completionDate: status === BookingStatus.COMPLETED ? faker.date.recent({ days: 3 }) : null,
          workerArrivedAt: hasArrived ? faker.date.recent({ days: 4 }) : null,
          workerStartedAt: hasArrived ? faker.date.recent({ days: 4 }) : null,
          workerCompletedAt: isCompletedLike ? faker.date.recent({ days: 3 }) : null,
          paymentMethodType,
          paymentAccountIdentifier: paymentMethodType ? maskedAccountIdentifier(paymentMethodType) : null,
          location: faker.location.streetAddress(),
          city: faker.helpers.arrayElement(CITIES),
          notes: faker.datatype.boolean() ? faker.lorem.sentence(6) : null,
          clientLat: clientLoc.lat,
          clientLng: clientLoc.lng,
          workerLat: hasArrived ? workerLoc.lat : null,
          workerLng: hasArrived ? workerLoc.lng : null,
          distanceMeters,
        },
      });
    } catch {
      // Skip rare worker/date/time collisions (worker_slot_unique constraint)
      continue;
    }

    bookingIds.push(booking.id);

    // DeclinedWorker audit rows to back declinedWorkerIds.
    for (const declinedId of declinedIds) {
      await prisma.declinedWorker.create({
        data: {
          bookingId: booking.id,
          workerId: declinedId,
          reason: faker.helpers.arrayElement([
            "Outside service area",
            "Max concurrent jobs reached",
            "Did not respond in time",
          ]),
        },
      });
    }

    // Add-ons on roughly a third of bookings, snapshotted onto the booking too.
    let addOnsSnapshot: Array<{ name: string; price: number }> | null = null;
    if (faker.datatype.boolean() && faker.datatype.boolean()) {
      const addOnCount = faker.number.int({ min: 1, max: 2 });
      addOnsSnapshot = [];
      for (let a = 0; a < addOnCount; a++) {
        const name = faker.commerce.productName();
        const price = faker.number.int({ min: 50, max: 300 });
        await prisma.bookingAddOn.create({ data: { bookingId: booking.id, name, price } });
        addOnsSnapshot.push({ name, price });
      }
      await prisma.booking.update({
        where: { id: booking.id },
        data: { addOnsSnapshot },
      });
    }

    // Arrival verification for any booking where the worker has checked in.
    if (hasArrived && distanceMeters !== null) {
      await prisma.arrivalVerification.create({
        data: {
          bookingId: booking.id,
          workerLat: workerLoc.lat,
          workerLng: workerLoc.lng,
          distanceMeters,
          isVerified: index !== 9, // one deliberately outside the geofence
        },
      });
    }

    // Pricing log — itemized snapshot of how the estimate was computed.
    const conditionFee = condition === ConditionType.HEAVY ? 150 : condition === ConditionType.NORMAL ? 50 : 0;
    const distanceFee = distanceMeters ? Math.round((distanceMeters / 1000) * 5) : 0;
    const addOnsTotal = addOnsSnapshot ? addOnsSnapshot.reduce((sum, a) => sum + a.price, 0) : 0;
    await prisma.pricingLog.create({
      data: {
        bookingId: booking.id,
        basePrice: task ? task.basePrice : serviceType.basePrice,
        conditionFee,
        distanceFee,
        addOnsTotal,
        finalEstimate: estimatedPrice + conditionFee + distanceFee + addOnsTotal,
        breakdown: { conditionFee, distanceFee, addOnsTotal, source: "seed-complete" },
      },
    });

    // Cancellation record.
    if (status === BookingStatus.CANCELLED && scenario.cancelledBy) {
      const cancelledById =
        scenario.cancelledBy === Role.CLIENT
          ? client.id
          : scenario.cancelledBy === Role.WORKER
          ? worker!.id
          : admin.id;
      const feeCharged = scenario.cancelledBy === Role.CLIENT ? 100 : 0;
      await prisma.cancellation.create({
        data: {
          bookingId: booking.id,
          cancelledBy: scenario.cancelledBy,
          cancelledById,
          reason:
            scenario.cancelledBy === Role.CLIENT
              ? "Client rescheduled to a later date."
              : scenario.cancelledBy === Role.WORKER
              ? "Worker had an emergency and could not make it."
              : "Cancelled by admin due to a policy violation.",
          feeCharged,
          refundAmount: estimatedPrice - feeCharged,
        },
      });
    }

    // Dispute record (separate from the summary fields already on Booking).
    if (isDisputed && scenario.disputeStatus) {
      const raisedById = faker.helpers.arrayElement([client.id, worker!.id]);
      const resolved = scenario.disputeStatus === "RESOLVED" || scenario.disputeStatus === "REJECTED";
      await prisma.dispute.create({
        data: {
          bookingId: booking.id,
          raisedById,
          reason: faker.lorem.sentence(10),
          evidenceUrls: [
            `https://example-storage.dev/disputes/${booking.id}/evidence-1.jpg`,
            `https://example-storage.dev/disputes/${booking.id}/evidence-2.jpg`,
          ],
          status: scenario.disputeStatus,
          resolution: resolved ? faker.lorem.sentence(12) : null,
          resolvedById: resolved ? admin.id : null,
          resolvedAt: resolved ? faker.date.recent({ days: 1 }) : null,
          refundAmount: scenario.disputeStatus === "RESOLVED" ? Math.round(estimatedPrice * 0.5) : null,
        },
      });
    }

    // Payment — authorized at booking time for any live booking, captured on completion.
    if (worker && paymentEligibleStatuses.has(status)) {
      const subtotal = estimatedPrice;
      const tip = booking.tip ?? 0;
      const commissionRate = 0.1;
      const withholdingTaxRate = 0.05;
      const commissionAmount = subtotal * commissionRate;
      const withholdingTaxAmount = subtotal * withholdingTaxRate;
      const workerPayout = subtotal - commissionAmount - withholdingTaxAmount + tip;
      const methodType = paymentMethodType ?? PaymentMethodType.GCASH;

      const isCompleted = status === BookingStatus.COMPLETED;
      const paymentStatus =
        scenario.paymentStatusOverride ?? (isCompleted ? PaymentStatus.COMPLETED : PaymentStatus.PENDING);
      const escrowStatus =
        paymentStatus === PaymentStatus.REFUNDED
          ? EscrowStatus.REFUNDED
          : isCompleted && scenario.payoutStatus
          ? EscrowStatus.RELEASED
          : EscrowStatus.HELD;
      const refunded = paymentStatus === PaymentStatus.REFUNDED;

      const authorizedAt = faker.date.recent({ days: 6 });
      const authorizationId = `auth_${faker.string.alphanumeric(20)}`;
      const paymentIntentId = `pi_${faker.string.alphanumeric(20)}`;
      const clientSecret = `${paymentIntentId}_secret_${faker.string.alphanumeric(12)}`;

      const payment = await prisma.payment.create({
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
          status: paymentStatus,
          escrowStatus,
          releasedAt: escrowStatus === EscrowStatus.RELEASED ? faker.date.recent({ days: 2 }) : null,
          refundReason: refunded ? "Client reported no-show; refunded per policy." : null,
          refundedAt: refunded ? faker.date.recent({ days: 1 }) : null,
          paymongoPaymentId: methodType !== PaymentMethodType.CASH ? `pay_${faker.string.alphanumeric(20)}` : null,
          paymongoSourceId: methodType !== PaymentMethodType.CASH ? `src_${faker.string.alphanumeric(20)}` : null,
          authorizedAmount: subtotal,
          authorizedAt,
          authorizationId,
          capturedAmount: isCompleted ? subtotal : null,
          capturedAt: isCompleted ? faker.date.recent({ days: 2 }) : null,
          paymentIntentId,
          clientSecret,
          methodType,
          accountIdentifier: maskedAccountIdentifier(methodType),
        },
      });

      // Payout — only once escrow has actually been released to the worker.
      if (escrowStatus === EscrowStatus.RELEASED && scenario.payoutStatus) {
        const wp = worker.workerProfile!;
        const payoutStatus = scenario.payoutStatus;
        await prisma.payout.create({
          data: {
            paymentId: payment.id,
            bookingId: booking.id,
            workerId: worker.id,
            amount: workerPayout,
            channel: (wp.payoutMethod as PaymentMethodType) ?? PaymentMethodType.GCASH,
            accountName: wp.payoutAccountName,
            accountNumber: wp.payoutAccountNumber ?? phoneNumber(),
            status: payoutStatus,
            paymongoTransferId:
              payoutStatus !== PayoutStatus.FAILED ? `trsf_${faker.string.alphanumeric(20)}` : null,
            paymongoTransferStatus:
              payoutStatus === PayoutStatus.PAID
                ? "succeeded"
                : payoutStatus === PayoutStatus.PROCESSING
                ? "pending"
                : null,
            xenditDisbursementId: scenario.legacyXendit ? `disb-${faker.string.alphanumeric(16)}` : null,
            xenditStatus: scenario.legacyXendit ? "FAILED" : null,
            failureReason: payoutStatus === PayoutStatus.FAILED ? "Bank rejected transfer: invalid account." : null,
            attempts: payoutStatus === PayoutStatus.PENDING ? 0 : payoutStatus === PayoutStatus.FAILED ? 2 : 1,
            processingAt: payoutStatus !== PayoutStatus.PENDING ? faker.date.recent({ days: 2 }) : null,
            paidAt: payoutStatus === PayoutStatus.PAID ? faker.date.recent({ days: 1 }) : null,
            failedAt: payoutStatus === PayoutStatus.FAILED ? faker.date.recent({ days: 1 }) : null,
          },
        });
      }

      // Review — only for genuinely completed jobs.
      if (isCompleted) {
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
  }

  return bookingIds;
}

async function main() {
  console.log("Clearing existing data...");
  await clearData();

  console.log("Creating service categories (including scope fields and one inactive)...");
  const serviceTypes = await createServiceTypes();

  console.log("Creating pricing rules...");
  await createPricingRules(serviceTypes);

  console.log("Creating admin...");
  const admin = await createAdmin();

  console.log(`Creating ${NUM_CLIENTS} clients (with status/soft-delete variety)...`);
  const clients = [];
  for (let i = 0; i < NUM_CLIENTS; i++) {
    clients.push(await createClient(i));
  }

  console.log(`Creating ${WORKERS_PER_CATEGORY} workers per category (all KYC states, skills, availability)...`);
  const workers = [];
  const activeCategories = serviceTypes.filter((s) => s.tasks.length && s.isActive);
  const kycRotation = [KYCStatus.APPROVED, KYCStatus.PENDING, KYCStatus.SUBMITTED, KYCStatus.REJECTED];
  let workerIndex = 0;
  for (const category of activeCategories) {
    for (let i = 0; i < WORKERS_PER_CATEGORY; i++) {
      const kycOverride = kycRotation[workerIndex % kycRotation.length];
      const fullDocSet = workerIndex === 0; // first worker gets every KycDocumentType
      const worker = await createWorker(category, kycOverride, fullDocSet, workerIndex);

      // Worker packages — priced bundles under the worker's own category.
      const packageCount = workerIndex % 3 === 0 ? 1 : 2;
      for (let p = 0; p < packageCount; p++) {
        await prisma.workerPackage.create({
          data: {
            workerProfileId: worker.workerProfile!.id,
            serviceTypeId: category.id,
            name: `${category.name} ${p === 0 ? "Standard" : "Deep"} Package`,
            description: p === 0 ? null : `Includes extra ${category.name.toLowerCase()} add-ons and a follow-up visit.`,
            price: faker.number.int({ min: 400, max: 2000 }),
            isActive: !(workerIndex === 1 && p === 1), // one inactive package for variety
          },
        });
      }

      workers.push(worker);
      workerIndex++;
    }
  }

  console.log("Creating auth tokens (all token types)...");
  await createAuthTokens([admin, ...clients, ...workers]);

  console.log("Creating bookings, add-ons, payments, payouts, disputes, and reviews...");
  const approvedWorkers = workers.filter((w) => w.workerProfile!.kycStatus === KYCStatus.APPROVED);
  const bookingIds = await createBookingsAndPayments(
    clients,
    approvedWorkers.length ? approvedWorkers : workers,
    workers,
    serviceTypes,
    admin
  );

  console.log("Creating messages between clients and workers...");
  await createMessages(clients, workers);

  console.log("Creating notifications (all notification types)...");
  await createNotifications(clients, workers, bookingIds);

  console.log("Creating audit log entries...");
  await createAuditLogs(admin);

  console.log("Creating app settings (non-default platform configuration)...");
  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      siteName: "HomeEase On-Demand",
      supportEmail: "support@homeease.ph",
      notificationsEnabled: true,
      commissionRate: 0.12,
      withholdingTaxRate: 0.05,
      maxSlotsPerDay: 3,
      pendingExpiryMinutes: 45,
      geofenceRadiusMeters: 150,
    },
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
