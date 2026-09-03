import prisma from '@config/database';

export interface AppSettingsConfig {
  siteName: string;
  supportEmail: string;
  notificationsEnabled: boolean;
  commissionRate: number;
  withholdingTaxRate: number;
  maxSlotsPerDay: number;
  pendingExpiryMinutes: number;
  geofenceRadiusMeters: number;
  maxDeclinesBeforeCooldown: number;
  declineWindowHours: number;
  declineCooldownHours: number;
  tierProMinRating: number;
  tierProMinJobs: number;
  tierProMultiplier: number;
  tierExpertMinRating: number;
  tierExpertMinJobs: number;
  tierExpertMultiplier: number;
  workerDebtHoldLimit: number;
}

// Mirrors the AppSettings model's own @default values — used only if the
// columns backing this migration haven't been applied to the database yet,
// so core flows (booking payment, availability, arrival check-in) that now
// depend on this getter keep working against an un-migrated database.
const FALLBACK_DEFAULTS: AppSettingsConfig = {
  siteName: 'HomeEaseAdmin',
  supportEmail: 'support@homeease.dev',
  notificationsEnabled: true,
  commissionRate: 0.1,
  withholdingTaxRate: 0.02,
  maxSlotsPerDay: 2,
  pendingExpiryMinutes: 60,
  geofenceRadiusMeters: 100,
  maxDeclinesBeforeCooldown: 3,
  declineWindowHours: 168,
  declineCooldownHours: 24,
  tierProMinRating: 4.5,
  tierProMinJobs: 20,
  tierProMultiplier: 1.15,
  tierExpertMinRating: 4.8,
  tierExpertMinJobs: 50,
  tierExpertMultiplier: 1.3,
  workerDebtHoldLimit: 500,
};

// getAppSettings is called on nearly every request path (search, booking,
// payments, ...). Without a cache each call is a DB round-trip — and an
// upsert (write) at that — to the remote Neon instance, which measurably
// adds up. Settings only change via an admin action (see
// settingsController.invalidateAppSettingsCache), so a short TTL is enough
// to keep this fresh without paying for a query on every request.
const CACHE_TTL_MS = 60_000;
let cached: AppSettingsConfig | null = null;
let cachedAt = 0;

/**
 * Reads the singleton AppSettings row, creating it with schema defaults on
 * first access. Business rules that must react to an admin's live setting
 * change (worker slot cap, arrival geofence radius, pending-booking hold
 * timeout, platform commission/tax split) read through this getter instead
 * of a static config constant.
 */
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
    cached = record;
    cachedAt = Date.now();
    return record;
  } catch (error) {
    console.error('getAppSettings failed (pending migration?) — using static defaults:', error);
    return cached ?? FALLBACK_DEFAULTS;
  }
}

/** Called after an admin updates AppSettings so the next read isn't stale for up to CACHE_TTL_MS. */
export function invalidateAppSettingsCache(): void {
  cached = null;
}
