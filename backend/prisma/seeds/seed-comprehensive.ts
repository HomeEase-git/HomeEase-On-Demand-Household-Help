// prisma/seeds/seed-comprehensive.ts
//
// The current "everything" seed — every model in schema.prisma gets rows,
// every nullable/optional column gets a real value on at least one row, and
// every role gets exactly 20 users (20 admins, 20 clients, 20 workers).
//
// Supersedes seed-complete.ts, which predates the pay-after-completion
// payment rework and the TIN/2307/debt-ledger tax-compliance build — this
// file models the CURRENT business logic (see paymentLifecycleService.ts,
// debtLedgerService.ts, taxCertificateService.ts, bookingWorker.ts):
//   - No Payment row exists until a booking is confirmed complete. CASH
//     settles immediately; GCASH/MAYA moves the booking to AWAITING_PAYMENT
//     with a Xendit invoice outstanding.
//   - WorkerProfile.commissionOwed / debtHoldAt / DebtLedgerEntry track
//     platform dues accrued on cash jobs and recovered from online payouts.
//   - WorkerProfile.tin backs BIR Form 2307 TaxCertificate generation and
//     platform-level TaxRemittance bookkeeping.
//
// Run with: npx tsx prisma/seeds/seed-comprehensive.ts   (from the backend folder)
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
  UrgencyLevel,
  ScopeFieldType,
  ServiceScopeType,
  DebtLedgerEntryType,
  TaxCertificateStatus,
  TaxRemittanceStatus,
} from "@prisma/client";
import { faker } from "@faker-js/faker";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DEFAULT_PASSWORD = "Password123!";
const NUM_ADMINS = 20;
const NUM_CLIENTS = 20;
const NUM_WORKERS = 20;

const CITIES = [
  "Plaridel", "Malolos", "San Fernando", "Angeles City", "Quezon City",
  "Manila", "Makati", "Pasig", "Marikina", "Caloocan", "Taguig", "Bulacan",
];

const ROOM_TYPES: RoomType[] = [
  RoomType.BEDROOM, RoomType.BATHROOM, RoomType.KITCHEN, RoomType.LIVING_ROOM,
  RoomType.DINING_ROOM, RoomType.OFFICE, RoomType.GARAGE, RoomType.BALCONY, RoomType.OTHER,
];

const CONDITION_TYPES: ConditionType[] = [ConditionType.TIDY, ConditionType.NORMAL, ConditionType.HEAVY];

const URGENCY_LEVELS: UrgencyLevel[] = [UrgencyLevel.STANDARD, UrgencyLevel.URGENT, UrgencyLevel.EMERGENCY];
const URGENCY_FEE_MULTIPLIER: Record<UrgencyLevel, number> = { STANDARD: 0, URGENT: 0.15, EMERGENCY: 0.3 };

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
  icon: string;
  tasks: { name: string; description?: string; basePrice: number; durationHours: number }[];
  scopeType?: ServiceScopeType;
  hasCondition?: boolean;
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
    tasks: [
      { name: "Washing Machine Repair", description: "Diagnose and fix a washing machine fault.", basePrice: 550, durationHours: 2 },
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
    icon: "bug-outline",
    tasks: [
      { name: "Termite Treatment", description: "Inspect and treat an active termite infestation.", basePrice: 1200, durationHours: 3 },
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

const PAYOUT_CHANNELS: PaymentMethodType[] = [PaymentMethodType.GCASH, PaymentMethodType.MAYA];

function phoneNumber() {
  return "09" + faker.string.numeric(9);
}

function expoPushToken() {
  return `ExponentPushToken[${faker.string.alphanumeric(22)}]`;
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

function randomTin() {
  return `${faker.string.numeric(3)}-${faker.string.numeric(3)}-${faker.string.numeric(3)}`;
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
  await prisma.debtLedgerEntry.deleteMany();
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
  await prisma.taxCertificate.deleteMany();
  await prisma.taxRemittance.deleteMany();
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
  // One inactive service type, to exercise isActive=false on both models and
  // a ServiceType with no icon assigned (predates the icon picker).
  const inactive = await prisma.serviceType.create({
    data: {
      name: "Landscaping (Retired)",
      description: "Discontinued category kept for historical bookings",
      basePrice: 400,
      isActive: false,
      icon: null,
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

async function createAdmin(index: number) {
  const password = await hashPassword(DEFAULT_PASSWORD);

  if (index === 0) {
    // Canonical login used across docs/tests.
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
        pushToken: expoPushToken(),
      },
    });
  }

  const fullName = faker.person.fullName();
  const email = faker.internet
    .email({ firstName: fullName.split(" ")[0], provider: "homeease.dev" })
    .toLowerCase();

  // A little status/soft-delete variety in the back-office roster too, so
  // admin-facing "manage admins" screens have real edge cases to show.
  let status: UserStatus = UserStatus.ACTIVE;
  let isDeleted = false;
  let deletedAt: Date | null = null;
  if (index === 1) status = UserStatus.SUSPENDED; // e.g. disabled pending an internal review
  if (index === 2) {
    status = UserStatus.DELETED;
    isDeleted = true;
    deletedAt = faker.date.recent({ days: 60 });
  }

  return prisma.user.create({
    data: {
      email,
      phone: index === 3 ? null : phoneNumber(),
      password,
      fullName,
      role: Role.ADMIN,
      isVerified: index !== 4,
      avatar: faker.image.avatar(),
      notificationPreferences: { email: true, push: faker.datatype.boolean(), sms: faker.datatype.boolean() },
      status,
      isDeleted,
      deletedAt,
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
      pushToken: index === 10 ? expoPushToken() : null,
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

// Specific, narratively-consistent commissionOwed / debtHoldAt / DebtLedgerEntry
// histories for a handful of workers — guarantees every DebtLedgerEntryType
// and every debt-hold state (never held, currently held, held-then-released)
// shows up at least once. Numbers are chosen relative to the
// AppSettings.workerDebtHoldLimit = 600 seeded below.
type DebtOverride = {
  commissionOwed: number;
  debtHoldAt: Date | null;
  debtHoldNote: string | null;
  forceUnavailable?: boolean;
  ledger: Array<{ type: DebtLedgerEntryType; amount: number; balanceAfter: number; note: string }>;
};

function debtScenarioFor(workerIndex: number): DebtOverride | null {
  if (workerIndex === 2) {
    // Accrued debt from a cash job, then partially forgiven by an admin.
    return {
      commissionOwed: 270,
      debtHoldAt: null,
      debtHoldNote: null,
      ledger: [
        {
          type: DebtLedgerEntryType.COMMISSION_DEBIT,
          amount: 320,
          balanceAfter: 320,
          note: "Commission + withholding tax on a cash job (paid to you in person)",
        },
        {
          type: DebtLedgerEntryType.ADMIN_ADJUSTMENT,
          amount: -50,
          balanceAfter: 270,
          note: "Goodwill adjustment after a billing dispute",
        },
      ],
    };
  }
  if (workerIndex === 3) {
    // Crossed the hold limit — account currently on hold.
    return {
      commissionOwed: 650,
      debtHoldAt: faker.date.recent({ days: 5 }),
      debtHoldNote: null,
      forceUnavailable: true,
      ledger: [
        {
          type: DebtLedgerEntryType.COMMISSION_DEBIT,
          amount: 650,
          balanceAfter: 650,
          note: "Commission + withholding tax on a cash job (paid to you in person)",
        },
      ],
    };
  }
  if (workerIndex === 4) {
    // Was held, paid it down, admin explicitly released the hold.
    return {
      commissionOwed: 0,
      debtHoldAt: null,
      debtHoldNote: "Cleared after worker paid down balance in person; confirmed via support ticket #4821.",
      ledger: [
        {
          type: DebtLedgerEntryType.COMMISSION_DEBIT,
          amount: 650,
          balanceAfter: 650,
          note: "Commission + withholding tax on a cash job (paid to you in person)",
        },
        {
          type: DebtLedgerEntryType.DEBT_RECOVERY,
          amount: -650,
          balanceAfter: 0,
          note: "Withheld from payout to clear outstanding cash-job commission dues",
        },
      ],
    };
  }
  if (workerIndex === 5) {
    // Debt partially reversed after a cash-job refund.
    return {
      commissionOwed: 150,
      debtHoldAt: null,
      debtHoldNote: null,
      ledger: [
        {
          type: DebtLedgerEntryType.COMMISSION_DEBIT,
          amount: 300,
          balanceAfter: 300,
          note: "Commission + withholding tax on a cash job (paid to you in person)",
        },
        {
          type: DebtLedgerEntryType.REVERSAL,
          amount: -150,
          balanceAfter: 150,
          note: "Reversed cash-job commission after refund: client reported a no-show",
        },
      ],
    };
  }
  return null;
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
  const homeLoc = randomLatLng(); // geocoded service base -> addressLat/addressLng
  const liveLoc = randomLatLng(); // last GPS check-in -> currentLat/currentLng
  const payoutMethod = faker.helpers.arrayElement(PAYOUT_CHANNELS);

  const debtOverride = debtScenarioFor(workerIndex);
  const commissionOwed = debtOverride?.commissionOwed ?? 0;
  const debtHoldAt = debtOverride?.debtHoldAt ?? null;
  const debtHoldNote = debtOverride?.debtHoldNote ?? null;
  const heldByDebt = !!debtOverride?.forceUnavailable;

  // TIN coverage: every approved worker (payout/tax eligible) plus a couple
  // of others, so tinVerifiedAt=null (submitted, not yet checked) also shows up.
  const hasTin = isApproved || workerIndex % 7 === 1;
  const tin = hasTin ? randomTin() : null;
  const tinVerifiedAt = hasTin && workerIndex % 2 === 0 ? faker.date.recent({ days: 60 }) : null;

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
      pushToken: workerIndex === 0 ? expoPushToken() : null,
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
          isAvailable: !isRejected && !heldByDebt,
          maxConcurrentJobs: faker.helpers.arrayElement([1, 2, 3]),
          activeJobCount: faker.number.int({ min: 0, max: 2 }),
          availableDays: faker.helpers.arrayElement([
            [1, 2, 3, 4, 5],
            [0, 1, 2, 3, 4, 5, 6],
            [1, 3, 5],
          ]),
          serviceAreaRadius: faker.helpers.arrayElement([15, 20, 30]),
          declineCooldownUntil: workerIndex === 6 ? faker.date.soon({ days: 2 }) : null,
          acceptsHeavyCondition: workerIndex % 2 === 0,
          acceptsPets: workerIndex % 3 !== 0,
          preferredRoomTypes: faker.helpers.arrayElements(ROOM_TYPES, { min: 1, max: 3 }),
          hourlyRate: faker.number.float({ min: 150, max: 600, fractionDigits: 2 }),
          city,
          state: "Philippines",
          address: faker.location.streetAddress(),
          zipCode: faker.location.zipCode("####"),
          addressLat: homeLoc.lat,
          addressLng: homeLoc.lng,
          currentLat: isRejected ? null : liveLoc.lat,
          currentLng: isRejected ? null : liveLoc.lng,
          lastLocationUpdate: isRejected ? null : faker.date.recent({ days: 1 }),
          kycStatus,
          kycSubmittedAt: faker.date.recent({ days: 30 }),
          kycApprovedAt: isApproved ? faker.date.recent({ days: 15 }) : null,
          resumeUrl: "https://example-storage.dev/resumes/placeholder.pdf",
          payoutMethod,
          payoutAccountName: fullName,
          payoutAccountNumber: phoneNumber(),
          tin,
          tinVerifiedAt,
          commissionOwed,
          debtHoldAt,
          debtHoldNote,
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

  if (debtOverride) {
    for (const entry of debtOverride.ledger) {
      await prisma.debtLedgerEntry.create({
        data: {
          workerProfileId: user.workerProfile!.id,
          type: entry.type,
          amount: entry.amount,
          balanceAfter: entry.balanceAfter,
          note: entry.note,
        },
      });
    }
  }

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
      // Distinct from WorkerProfile.kycStatus — the real app only ever
      // writes PENDING/APPROVED/REJECTED here (never SUBMITTED), since a
      // VerificationRequest starts PENDING and only leaves that state via
      // admin decision. See verificationController.uploadVerificationDocuments
      // and adminVerificationController.approve/rejectVerification.
      status: isApproved ? KYCStatus.APPROVED : isRejected ? KYCStatus.REJECTED : KYCStatus.PENDING,
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
  for (const extra of users.slice(tokenTypes.length, tokenTypes.length + 15)) {
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
  for (let i = 0; i < 10; i++) {
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
      message: "Xendit payout failed: insufficient platform balance.",
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
    {
      actorId: null,
      actorName: "System",
      actorRole: null,
      action: "PAYMENT_OVERDUE_ESCALATED",
      category: "STATUS_CHANGE",
      level: "WARN",
      message: "Booking auto-escalated to a dispute after 72h unpaid.",
      metadata: { thresholdHours: 72 },
    },
    {
      actorId: admin.id,
      actorName: admin.fullName,
      actorRole: "ADMIN",
      action: "TAX_REMITTANCE_MARKED_PAID",
      category: "ADMIN_ACTION",
      level: "INFO",
      message: "Admin marked Q1 2026 BIR withholding-tax remittance as filed and paid.",
      metadata: { periodStart: "2026-01-01", periodEnd: "2026-04-01" },
    },
  ];

  for (const entry of entries) {
    await prisma.auditLog.create({ data: entry });
  }
}

async function createTaxRecords(
  workers: Awaited<ReturnType<typeof createWorker>>[],
  admin: { id: string }
) {
  const withTin = workers.filter((w) => w.workerProfile!.tin);
  if (withTin.length === 0) return;

  const issuedWorker = withTin[0];
  const draftWorker = withTin[Math.min(1, withTin.length - 1)];

  const q1Start = new Date("2026-01-01T00:00:00.000Z");
  const q1End = new Date("2026-04-01T00:00:00.000Z");
  const q2Start = new Date("2026-04-01T00:00:00.000Z");
  const q2End = new Date("2026-07-01T00:00:00.000Z");

  await prisma.taxCertificate.create({
    data: {
      workerId: issuedWorker.id,
      periodStart: q1Start,
      periodEnd: q1End,
      workerName: issuedWorker.fullName,
      workerTin: issuedWorker.workerProfile!.tin!,
      totalIncomePayments: 18500.0,
      totalTaxWithheld: 362.6,
      pdfPath: `${issuedWorker.id}/2026-01-01_2026-04-01_${faker.string.uuid()}.pdf`,
      status: TaxCertificateStatus.ISSUED,
      issuedAt: faker.date.between({ from: q1End, to: "2026-04-10T00:00:00.000Z" }),
      generatedBy: admin.id,
    },
  });

  await prisma.taxCertificate.create({
    data: {
      workerId: draftWorker.id,
      periodStart: q2Start,
      periodEnd: q2End,
      workerName: draftWorker.fullName,
      workerTin: draftWorker.workerProfile!.tin!,
      totalIncomePayments: 21140.5,
      totalTaxWithheld: 414.35,
      pdfPath: `${draftWorker.id}/2026-04-01_2026-07-01_${faker.string.uuid()}.pdf`,
      status: TaxCertificateStatus.DRAFT,
      issuedAt: null,
      generatedBy: admin.id,
    },
  });

  await prisma.taxRemittance.create({
    data: {
      periodStart: q1Start,
      periodEnd: q1End,
      totalTaxWithheld: 4820.5,
      status: TaxRemittanceStatus.REMITTED,
      referenceNumber: "BIR-OR-2026-00042",
      remittedAt: new Date("2026-04-12T00:00:00.000Z"),
      remittedBy: admin.id,
      notes: "Filed via BIR eFPS; official receipt attached to the admin drive.",
    },
  });

  await prisma.taxRemittance.create({
    data: {
      periodStart: q2Start,
      periodEnd: q2End,
      totalTaxWithheld: 5310.25,
      status: TaxRemittanceStatus.PENDING,
      referenceNumber: null,
      remittedAt: null,
      remittedBy: null,
      notes: null,
    },
  });
}

type Scenario = {
  status: BookingStatus;
  unassigned?: boolean;
  noTask?: boolean;
  isAutoMatched?: boolean;
  urgencyLevel?: UrgencyLevel;
  disputeStatus?: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "REJECTED";
  arrivalNotVerified?: boolean;
  forceMethod?: "GATEWAY" | "CASH";
  quoteReminderSent?: boolean;
  completionReminderSent?: boolean;
  awaitingPaymentReminderSent?: boolean;
  awaitingPaymentFailed?: boolean;
  awaitingPaymentOverdueDispute?: boolean;
  payoutStatus?: PayoutStatus;
  disbursementFailedWithId?: boolean;
  noSettleYet?: boolean;
  refundedAfterCompletion?: boolean;
  cancelledBy?: Role;
  idempotencyKey?: boolean;
};

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

  const scenarios: Scenario[] = [
    { status: BookingStatus.PENDING, unassigned: true, isAutoMatched: true },
    { status: BookingStatus.PENDING, noTask: true, idempotencyKey: true },
    { status: BookingStatus.ACCEPTED },
    { status: BookingStatus.REJECTED },
    { status: BookingStatus.IN_PROGRESS, urgencyLevel: UrgencyLevel.URGENT },
    { status: BookingStatus.QUOTE_SUBMITTED, quoteReminderSent: true },
    { status: BookingStatus.QUOTE_APPROVED },
    { status: BookingStatus.PENDING_COMPLETION, completionReminderSent: true },
    // AWAITING_PAYMENT — pay-after-completion, GCash/Maya invoice outstanding.
    { status: BookingStatus.AWAITING_PAYMENT, forceMethod: "GATEWAY" },
    {
      status: BookingStatus.AWAITING_PAYMENT,
      forceMethod: "GATEWAY",
      completionReminderSent: true,
      awaitingPaymentReminderSent: true,
    },
    {
      status: BookingStatus.AWAITING_PAYMENT,
      forceMethod: "GATEWAY",
      completionReminderSent: true,
      awaitingPaymentReminderSent: true,
      awaitingPaymentFailed: true,
      awaitingPaymentOverdueDispute: true,
    },
    { status: BookingStatus.DISPUTED, disputeStatus: "OPEN", arrivalNotVerified: true },
    { status: BookingStatus.DISPUTED, disputeStatus: "UNDER_REVIEW" },
    { status: BookingStatus.DISPUTED, disputeStatus: "RESOLVED" },
    { status: BookingStatus.DISPUTED, disputeStatus: "REJECTED" },
    // COMPLETED — every settlement shape the pay-after-completion model produces.
    { status: BookingStatus.COMPLETED, forceMethod: "CASH", isAutoMatched: true },
    { status: BookingStatus.COMPLETED, forceMethod: "GATEWAY", payoutStatus: PayoutStatus.PENDING },
    { status: BookingStatus.COMPLETED, forceMethod: "GATEWAY", payoutStatus: PayoutStatus.PROCESSING },
    {
      status: BookingStatus.COMPLETED,
      forceMethod: "GATEWAY",
      payoutStatus: PayoutStatus.PAID,
      urgencyLevel: UrgencyLevel.EMERGENCY,
    },
    {
      status: BookingStatus.COMPLETED,
      forceMethod: "GATEWAY",
      payoutStatus: PayoutStatus.FAILED,
      disbursementFailedWithId: true,
    },
    { status: BookingStatus.COMPLETED, forceMethod: "GATEWAY", noSettleYet: true },
    { status: BookingStatus.COMPLETED, forceMethod: "GATEWAY", refundedAfterCompletion: true },
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
    BookingStatus.AWAITING_PAYMENT,
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
    const urgencyLevel = scenario.urgencyLevel ?? faker.helpers.arrayElement(URGENCY_LEVELS);

    const clientLoc = randomLatLng();
    const workerLoc = randomLatLng();
    const hasArrived = !!worker && arrivalStatuses.has(status);
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

    let paymentMethodType: PaymentMethodType | null = null;
    if (worker) {
      if (scenario.forceMethod === "GATEWAY") {
        paymentMethodType = faker.helpers.arrayElement([PaymentMethodType.GCASH, PaymentMethodType.MAYA]);
      } else if (scenario.forceMethod === "CASH") {
        paymentMethodType = PaymentMethodType.CASH;
      } else {
        paymentMethodType = faker.helpers.arrayElement(Object.values(PaymentMethodType));
      }
    }

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
    const issuePhotoUrls = isCustomScope
      ? [`https://example-storage.dev/issue-photos/${faker.string.uuid()}.jpg`]
      : [];

    const isAwaitingPayment = status === BookingStatus.AWAITING_PAYMENT;
    const isCompleted = status === BookingStatus.COMPLETED;
    const isCompletedLike = isCompleted || status === BookingStatus.PENDING_COMPLETION || isAwaitingPayment;

    // acceptedAt — stamped once a worker accepts a PENDING request. Never set
    // for a still-PENDING/REJECTED booking, nor for a booking a client
    // cancelled pre-accept (blocked from cancelling post-accept — see
    // bookingController).
    const acceptedAt =
      worker && status !== BookingStatus.PENDING && status !== BookingStatus.REJECTED &&
      !(status === BookingStatus.CANCELLED && scenario.cancelledBy === Role.CLIENT)
        ? faker.date.recent({ days: 6 })
        : null;

    const awaitingPaymentSince = isAwaitingPayment ? faker.date.recent({ days: 3 }) : null;
    const paymentReminderSentAt =
      isAwaitingPayment && scenario.awaitingPaymentReminderSent ? faker.date.recent({ days: 1 }) : null;
    const completionReminderSentAt = scenario.completionReminderSent ? faker.date.recent({ days: 2 }) : null;
    const quoteReminderSentAt = scenario.quoteReminderSent ? faker.date.recent({ days: 1 }) : null;

    let booking;
    try {
      booking = await prisma.booking.create({
        data: {
          clientId: client.id,
          workerId: worker ? worker.id : null,
          isAutoMatched: !!scenario.isAutoMatched,
          declinedWorkerIds: declinedIds,
          expiresAt: scenario.unassigned ? faker.date.soon({ days: 1 }) : null,
          idempotencyKey: scenario.idempotencyKey ? faker.string.uuid() : null,
          serviceType: serviceType.name,
          serviceTaskId: task ? task.id : null,
          description: faker.lorem.sentence(10),
          estimatedDurationHours: task ? task.durationHours : null,
          rooms,
          condition,
          priorities,
          scopeAnswers: scopeAnswers ?? undefined,
          issuePhotoUrls,
          scheduledDate: faker.date.soon({ days: 14 }),
          scheduledTime: timeSlotChoice?.label ?? null,
          timeSlot: timeSlotChoice?.slot ?? null,
          urgencyLevel,
          status,
          estimatedPrice,
          tip: isCompleted ? faker.helpers.arrayElement([0, 50, 100]) : 0,
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
          quoteReminderSentAt,
          approvedAt: status === BookingStatus.QUOTE_APPROVED ? faker.date.recent({ days: 2 }) : null,
          disputeReason: isDisputed ? faker.lorem.sentence(10) : null,
          disputeResolvedById: disputeResolved ? admin.id : null,
          disputeResolvedAt: disputeResolved ? faker.date.recent({ days: 1 }) : null,
          inspectionFeeCharged: chargeInspectionFee,
          inspectionFeeAmount: chargeInspectionFee ? 150 : null,
          finalPrice: isCompleted || isAwaitingPayment ? estimatedPrice : null,
          acceptedAt,
          completionPhotoUrl: isCompletedLike
            ? `https://example-storage.dev/completions/${faker.string.uuid()}.jpg`
            : null,
          completionDate: isCompleted ? faker.date.recent({ days: 3 }) : null,
          workerArrivedAt: hasArrived ? faker.date.recent({ days: 4 }) : null,
          workerStartedAt: hasArrived ? faker.date.recent({ days: 4 }) : null,
          workerCompletedAt: isCompletedLike ? faker.date.recent({ days: 3 }) : null,
          completionReminderSentAt,
          awaitingPaymentSince,
          paymentReminderSentAt,
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
          isVerified: !scenario.arrivalNotVerified,
        },
      });
    }

    // Pricing log — itemized snapshot of how the estimate was computed,
    // mirroring bookingController.createBooking's fee stack.
    const conditionFee = condition === ConditionType.HEAVY ? 150 : condition === ConditionType.NORMAL ? 50 : 0;
    const distanceFee = distanceMeters ? Math.round((distanceMeters / 1000) * 5) : 0;
    const urgencyFee = Math.round(estimatedPrice * URGENCY_FEE_MULTIPLIER[urgencyLevel] * 100) / 100;
    const workerRating = worker?.workerProfile?.rating ?? 0;
    const tierFee =
      workerRating >= 4.7
        ? Math.round(estimatedPrice * 0.3 * 100) / 100
        : workerRating >= 4.4
        ? Math.round(estimatedPrice * 0.12 * 100) / 100
        : 0;
    const addOnsTotal = addOnsSnapshot ? addOnsSnapshot.reduce((sum, a) => sum + a.price, 0) : 0;
    await prisma.pricingLog.create({
      data: {
        bookingId: booking.id,
        basePrice: task ? task.basePrice : serviceType.basePrice,
        conditionFee,
        distanceFee,
        urgencyFee,
        tierFee,
        addOnsTotal,
        finalEstimate: estimatedPrice + conditionFee + distanceFee + urgencyFee + tierFee + addOnsTotal,
        breakdown: { conditionFee, distanceFee, urgencyFee, tierFee, addOnsTotal, source: "seed-comprehensive" },
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
      await prisma.cancellation.create({
        data: {
          bookingId: booking.id,
          cancelledBy: scenario.cancelledBy,
          cancelledById,
          reason:
            scenario.cancelledBy === Role.CLIENT
              ? "Client no longer needed the service."
              : scenario.cancelledBy === Role.WORKER
              ? "Worker had an emergency and could not make it."
              : "Cancelled by admin due to a policy violation.",
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

    // The 72h-unpaid-online-job self-heal: an OPEN dispute auto-raised
    // against a still-AWAITING_PAYMENT booking (see bookingWorker.escalateOverduePayment).
    // Deliberately NOT tied to a booking-status change — the booking stays
    // AWAITING_PAYMENT so the client can still finish the checkout.
    if (isAwaitingPayment && scenario.awaitingPaymentOverdueDispute) {
      await prisma.dispute.create({
        data: {
          bookingId: booking.id,
          raisedById: worker?.id ?? "system",
          reason: "Payment overdue — the client has not paid for a completed job",
          evidenceUrls: [],
          status: "OPEN",
        },
      });
    }

    // Payment — only created once a booking has actually been confirmed
    // complete (pay-after-completion model: no escrow/authorization upfront).
    if (worker && (isAwaitingPayment || isCompleted) && paymentMethodType) {
      const subtotal = estimatedPrice;
      const tip = booking.tip ?? 0;
      const commissionRate = 0.12;
      const withholdingTaxRate = 0.02;
      const commissionAmount = Math.round(subtotal * commissionRate * 100) / 100;
      const withholdingTaxAmount = Math.round((subtotal - commissionAmount) * withholdingTaxRate * 100) / 100;
      const workerPayout = Math.round((subtotal - commissionAmount - withholdingTaxAmount + tip) * 100) / 100;
      const totalAmount = subtotal + tip;

      if (isAwaitingPayment) {
        // GCASH/MAYA invoice raised, not yet paid.
        const failed = !!scenario.awaitingPaymentFailed;
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
            totalAmount,
            status: failed ? PaymentStatus.FAILED : PaymentStatus.PENDING,
            escrowStatus: EscrowStatus.HELD,
            failureReason: failed ? "EXPIRED" : null,
            xenditInvoiceId: `${faker.string.alphanumeric(24)}`,
            methodType: paymentMethodType,
            accountIdentifier: maskedAccountIdentifier(paymentMethodType),
          },
        });
      } else if (isCompleted) {
        if (paymentMethodType === PaymentMethodType.CASH) {
          // settleCashBooking: settled immediately, in person, no gateway,
          // never a Payout (CASH is not a valid payout channel).
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
              totalAmount,
              status: PaymentStatus.COMPLETED,
              escrowStatus: EscrowStatus.RELEASED,
              capturedAmount: totalAmount,
              capturedAt: faker.date.recent({ days: 2 }),
              releasedAt: faker.date.recent({ days: 2 }),
              workerSettledAt: faker.date.recent({ days: 2 }),
              methodType: PaymentMethodType.CASH,
              accountIdentifier: null,
            },
          });
        } else if (scenario.refundedAfterCompletion) {
          // Job paid via gateway, later refunded — settlement had already
          // been claimed (workerSettledAt set) before the refund cancelled
          // the not-yet-sent Payout (see paymentLifecycleService.refundOrVoidPayment).
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
              totalAmount,
              status: PaymentStatus.REFUNDED,
              escrowStatus: EscrowStatus.REFUNDED,
              refundReason: "Client reported unsatisfactory work quality.",
              refundedAt: faker.date.recent({ days: 1 }),
              xenditPaymentId: `ewc_${faker.string.alphanumeric(20)}`,
              xenditInvoiceId: `${faker.string.alphanumeric(24)}`,
              capturedAmount: totalAmount,
              capturedAt: faker.date.recent({ days: 3 }),
              releasedAt: faker.date.recent({ days: 3 }),
              workerSettledAt: faker.date.recent({ days: 3 }),
              // Legacy/deprecated CARD-era authorize-capture fields — no
              // longer written by current code, populated here only so the
              // columns have at least one real historical-looking row.
              authorizedAmount: subtotal,
              authorizedAt: faker.date.recent({ days: 4 }),
              authorizationId: `auth_${faker.string.alphanumeric(20)}`,
              paymentIntentId: `pi_${faker.string.alphanumeric(20)}`,
              clientSecret: `pi_${faker.string.alphanumeric(20)}_secret_${faker.string.alphanumeric(12)}`,
              methodType: paymentMethodType,
              accountIdentifier: maskedAccountIdentifier(paymentMethodType),
            },
          });

          const wp = worker.workerProfile!;
          await prisma.payout.create({
            data: {
              paymentId: payment.id,
              bookingId: booking.id,
              workerId: worker.id,
              amount: workerPayout,
              channel: (wp.payoutMethod as PaymentMethodType) ?? PaymentMethodType.GCASH,
              accountName: wp.payoutAccountName,
              accountNumber: wp.payoutAccountNumber ?? phoneNumber(),
              status: PayoutStatus.FAILED,
              xenditDisbursementId: null,
              xenditStatus: null,
              failureReason: "Booking refunded: client reported unsatisfactory work quality.",
              attempts: 0,
              failedAt: faker.date.recent({ days: 1 }),
            },
          });
        } else {
          // Gateway-paid via finalizePaidBooking. escrowStatus is always
          // flipped to RELEASED in that same call; workerSettledAt is set by
          // the settleWorkerEarnings call immediately after — UNLESS that
          // second step never ran (noSettleYet models exactly that gap,
          // which the reconciliation self-heal sweep exists to catch).
          const settled = !scenario.noSettleYet;
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
              totalAmount,
              status: PaymentStatus.COMPLETED,
              escrowStatus: EscrowStatus.RELEASED,
              releasedAt: faker.date.recent({ days: 2 }),
              xenditPaymentId: `ewc_${faker.string.alphanumeric(20)}`,
              xenditInvoiceId: `${faker.string.alphanumeric(24)}`,
              capturedAmount: totalAmount,
              capturedAt: faker.date.recent({ days: 2 }),
              workerSettledAt: settled ? faker.date.recent({ days: 2 }) : null,
              methodType: paymentMethodType,
              accountIdentifier: maskedAccountIdentifier(paymentMethodType),
            },
          });

          if (settled && scenario.payoutStatus) {
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
                xenditDisbursementId:
                  payoutStatus === PayoutStatus.PAID ||
                  payoutStatus === PayoutStatus.PROCESSING ||
                  scenario.disbursementFailedWithId
                    ? `disb-${faker.string.alphanumeric(16)}`
                    : null,
                xenditStatus:
                  payoutStatus === PayoutStatus.PAID
                    ? "COMPLETED"
                    : payoutStatus === PayoutStatus.PROCESSING
                    ? "ACCEPTED"
                    : payoutStatus === PayoutStatus.FAILED && scenario.disbursementFailedWithId
                    ? "FAILED"
                    : null,
                failureReason: payoutStatus === PayoutStatus.FAILED ? "Bank rejected transfer: invalid account." : null,
                attempts: payoutStatus === PayoutStatus.PENDING ? 0 : payoutStatus === PayoutStatus.FAILED ? 2 : 1,
                processingAt: payoutStatus !== PayoutStatus.PENDING ? faker.date.recent({ days: 2 }) : null,
                paidAt: payoutStatus === PayoutStatus.PAID ? faker.date.recent({ days: 1 }) : null,
                failedAt: payoutStatus === PayoutStatus.FAILED ? faker.date.recent({ days: 1 }) : null,
              },
            });
          }
        }
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
        const withPhotos = faker.datatype.boolean();

        await prisma.review.create({
          data: {
            bookingId: booking.id,
            workerId: worker.workerProfile!.id,
            clientId: client.id,
            rating: faker.number.float({ min: 1, max: 5, fractionDigits: 1 }),
            comment: faker.datatype.boolean() ? faker.lorem.sentence(8) : null,
            photoUrls: withPhotos
              ? [
                  `https://example-storage.dev/reviews/${booking.id}/photo-1.jpg`,
                  `https://example-storage.dev/reviews/${booking.id}/photo-2.jpg`,
                ]
              : [],
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

// Clients verify identity only (no trade credentials), so this is a lighter
// version of the worker verification block — just the 3 identity docs.
async function createClientVerification(
  client: Awaited<ReturnType<typeof createClient>>,
  status: typeof KYCStatus.PENDING | typeof KYCStatus.APPROVED | typeof KYCStatus.REJECTED
) {
  const isApproved = status === KYCStatus.APPROVED;
  const isRejected = status === KYCStatus.REJECTED;
  const docStatus = isApproved
    ? KycDocumentStatus.APPROVED
    : isRejected
    ? KycDocumentStatus.REJECTED
    : KycDocumentStatus.PENDING;
  const docTypes: KycDocumentType[] = [
    KycDocumentType.GOVERNMENT_ID_FRONT,
    KycDocumentType.GOVERNMENT_ID_BACK,
    KycDocumentType.SELFIE,
  ];

  await prisma.verificationRequest.create({
    data: {
      userId: client.id,
      type: "CLIENT_VERIFICATION",
      status,
      rejectionReason: isRejected ? "Selfie did not match the government ID photo." : null,
      reviewedAt: isApproved || isRejected ? faker.date.recent({ days: 10 }) : null,
      aiStatus: isApproved || isRejected ? "MATCH" : null,
      aiConfidence:
        isApproved || isRejected
          ? faker.number.float({ min: 0.85, max: 0.99, fractionDigits: 2 })
          : null,
      documents: {
        create: docTypes.map((type) => ({
          documentType: type,
          fileUrl: `https://example-storage.dev/kyc/${client.id}/${type.toLowerCase()}.jpg`,
          fileName: `${type.toLowerCase()}.jpg`,
          mimeType: "image/jpeg",
          status: docStatus,
          reviewedAt: isApproved || isRejected ? faker.date.recent({ days: 10 }) : null,
        })),
      },
    },
  });
}

async function main() {
  console.log("Clearing existing data...");
  await clearData();

  console.log("Creating service categories (icons, scope fields, one inactive)...");
  const serviceTypes = await createServiceTypes();

  console.log("Creating pricing rules...");
  await createPricingRules(serviceTypes);

  console.log(`Creating ${NUM_ADMINS} admins...`);
  const admins = [];
  for (let i = 0; i < NUM_ADMINS; i++) {
    admins.push(await createAdmin(i));
  }
  const admin = admins[0];

  console.log(`Creating ${NUM_CLIENTS} clients (with status/soft-delete variety)...`);
  const clients = [];
  for (let i = 0; i < NUM_CLIENTS; i++) {
    clients.push(await createClient(i));
  }

  console.log("Creating client identity verification requests...");
  await createClientVerification(clients[6], KYCStatus.PENDING);
  await createClientVerification(clients[7], KYCStatus.PENDING);
  await createClientVerification(clients[8], KYCStatus.APPROVED);
  await createClientVerification(clients[9], KYCStatus.REJECTED);

  console.log(`Creating ${NUM_WORKERS} workers (all KYC states, TIN/debt variety, skills, availability)...`);
  const workers = [];
  const activeCategories = serviceTypes.filter((s) => s.tasks.length && s.isActive);
  const kycRotation = [KYCStatus.APPROVED, KYCStatus.PENDING, KYCStatus.SUBMITTED, KYCStatus.REJECTED];
  for (let workerIndex = 0; workerIndex < NUM_WORKERS; workerIndex++) {
    const category = activeCategories[workerIndex % activeCategories.length];
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
  }

  console.log("Creating tax certificates and remittance records...");
  await createTaxRecords(workers, admin);

  console.log("Creating auth tokens (all token types)...");
  await createAuthTokens([...admins, ...clients, ...workers]);

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

  console.log("Creating app settings (every platform-config column set explicitly)...");
  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      siteName: "HomeEase On-Demand",
      supportEmail: "support@homeease.ph",
      notificationsEnabled: true,
      commissionRate: 0.12,
      withholdingTaxRate: 0.02,
      maxSlotsPerDay: 3,
      pendingExpiryMinutes: 45,
      geofenceRadiusMeters: 150,
      maxDeclinesBeforeCooldown: 4,
      declineWindowHours: 120,
      declineCooldownHours: 48,
      tierProMinRating: 4.4,
      tierProMinJobs: 15,
      tierProMultiplier: 1.12,
      tierExpertMinRating: 4.7,
      tierExpertMinJobs: 40,
      tierExpertMultiplier: 1.25,
      workerDebtHoldLimit: 600,
    },
  });

  console.log(
    `Done. Seeded ${serviceTypes.length} service types, ${admins.length} admins, ${clients.length} clients, ` +
      `${workers.length} workers, ${bookingIds.length} bookings.`
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
