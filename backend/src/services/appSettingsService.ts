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
  withholdingTaxRate: 0.05,
  maxSlotsPerDay: 2,
  pendingExpiryMinutes: 60,
  geofenceRadiusMeters: 100,
};

/**
 * Reads the singleton AppSettings row, creating it with schema defaults on
 * first access. Business rules that must react to an admin's live setting
 * change (worker slot cap, arrival geofence radius, pending-booking hold
 * timeout, platform commission/tax split) read through this getter instead
 * of a static config constant.
 */
export async function getAppSettings(): Promise<AppSettingsConfig> {
  try {
    return await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: { id: 'singleton' },
    });
  } catch (error) {
    console.error('getAppSettings failed (pending migration?) — using static defaults:', error);
    return FALLBACK_DEFAULTS;
  }
}
