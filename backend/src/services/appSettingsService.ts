import prisma from '@config/database';

export interface AppSettingsConfig {
  siteName: string;
  supportEmail: string;
  notificationsEnabled: boolean;
  commissionRate: number;
  withholdingTaxRate: number;
  pendingExpiryMinutes: number;
  geofenceRadiusMeters: number;
  maxDeclinesBeforeCooldown: number;
  declineWindowHours: number;
  declineCooldownHours: number;
  tierProMinRating: number;
  tierProMinJobs: number;
  tierProMinYears: number;
  tierProMultiplier: number;
  tierExpertMinRating: number;
  tierExpertMinJobs: number;
  tierExpertMinYears: number;
  tierExpertMultiplier: number;
  freeDistanceKm: number;
  perKmFee: number;
  workerDebtHoldLimit: number;
  workerMinAge: number;
  workerMaxAge: number;
  rushFeeRate: number;
  rushMinLeadHours: number;
  noShowGraceMinutes: number;
  noShowPenaltyAmount: number;
  clientFaultCompensationAmount: number;
  disputeEscalationHours: number;
  autoSuspendRatingThreshold: number | null;
  autoSuspendDisputeCountThreshold: number | null;
  autoSuspendDisputeCountWindowDays: number | null;
}

const FALLBACK_DEFAULTS: AppSettingsConfig = {
  siteName: 'HomeEaseAdmin',
  supportEmail: 'support@homeease.dev',
  notificationsEnabled: true,
  commissionRate: 0.1,
  withholdingTaxRate: 0,
  pendingExpiryMinutes: 60,
  geofenceRadiusMeters: 100,
  maxDeclinesBeforeCooldown: 3,
  declineWindowHours: 168,
  declineCooldownHours: 24,
  tierProMinRating: 4.5,
  tierProMinJobs: 20,
  tierProMinYears: 2,
  tierProMultiplier: 1.15,
  tierExpertMinRating: 4.8,
  tierExpertMinJobs: 50,
  tierExpertMinYears: 5,
  tierExpertMultiplier: 1.3,
  freeDistanceKm: 5,
  perKmFee: 10,
  workerDebtHoldLimit: 2500,
  workerMinAge: 18,
  workerMaxAge: 60,
  rushFeeRate: 0.25,
  rushMinLeadHours: 2,
  noShowGraceMinutes: 60,
  noShowPenaltyAmount: 200,
  clientFaultCompensationAmount: 200,
  disputeEscalationHours: 48,
  autoSuspendRatingThreshold: null,
  autoSuspendDisputeCountThreshold: null,
  autoSuspendDisputeCountWindowDays: null,
};

const CACHE_TTL_MS = 60_000;
let cached: AppSettingsConfig | null = null;
let cachedAt = 0;

const FIXED_TAX = { withholdingTaxRate: 0 } as const;

export async function getAppSettings(): Promise<AppSettingsConfig> {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cached;
  }

  try {
    const record = await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: { id: 'singleton' },
    });
    cached = { ...record, ...FIXED_TAX };
    cachedAt = Date.now();
    return cached;
  } catch (error) {
    console.error('getAppSettings failed (pending migration?) — using static defaults:', error);
    return cached ?? { ...FALLBACK_DEFAULTS, ...FIXED_TAX };
  }
}

export function invalidateAppSettingsCache(): void {
  cached = null;
}
